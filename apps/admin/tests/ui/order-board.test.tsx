// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocation } from 'react-router'

const session = vi.hoisted(() => ({ role: 'machine_operator', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null }))
const sync = vi.hoisted(() => ({ requestSync: vi.fn() }))
vi.mock('../../src/offline/request-sync', () => sync)
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))

import { OrdersPage } from '../../src/pages/orders/OrdersPage'
import { createCustomerLocally, createOrderLocally } from '../../src/offline/actions'
import { db } from '../../src/offline/db'
import { renderAt, resetApp } from './harness'

beforeEach(async () => { await resetApp('en'); session.role = 'machine_operator'; sync.requestSync.mockClear() })

let customerId = ''
async function order(status: string, over: Record<string, unknown> = {}) {
  if (!customerId) customerId = (await createCustomerLocally({ fullName: 'Karim Saad', phone: '+96170123456', whatsappOptIn: true })).customer.id
  const o = await createOrderLocally({ customerId, items: [{ name: 'Flyer', quantity: 1, unitPrice: 5 }] })
  await db.orders.update(o.id, { status, ...over })
  return (await db.orders.get(o.id))!
}
beforeEach(() => { customerId = '' })

function Where() { const l = useLocation(); return <p>at:{l.pathname}{l.search}</p> }
const openBoard = () => renderAt('/?view=board', [{ path: '/', element: <><OrdersPage /><Where /></> }])
const column = (name: string) => within(screen.getByRole('listitem', { name: new RegExp(`^${name}`) }))
const cardOf = (label: string) => screen.getByText(label, { selector: 'span[dir="ltr"]' }).closest('li')!
const label = (o: { order_number: string | null; public_code: string }) => (o.order_number ? `#${o.order_number}` : o.public_code.slice(0, 6))
const dt = () => ({ dataTransfer: { setData() {}, effectAllowed: '', dropEffect: '' } })

describe('the orders board', () => {
  it('stays a list by default, and the switch is kept in the address', async () => {
    const user = userEvent.setup()
    renderAt('/', [{ path: '/', element: <><OrdersPage /><Where /></> }])
    expect(screen.getByRole('button', { name: 'List' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('list', { name: 'Board' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Board' }))
    expect(screen.getByText('at:/?view=board')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Board' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show closed' })).toBeNull()  // the board only ever holds open orders

    await user.click(screen.getByRole('button', { name: 'List' }))
    expect(screen.getByText('at:/')).toBeTruthy()
  })

  it('puts each open order in its stage, most urgent first, and leaves closed ones off even when searching', async () => {
    const later = await order('printing', { due_at: '2999-01-01T00:00:00Z' })
    const late = await order('printing', { due_at: '2020-01-01T00:00:00Z' })
    const done = await order('delivered')
    openBoard()
    await screen.findByText(label(late), { selector: 'span[dir="ltr"]' })
    const printing = column('Printing')
    const order_ = printing.getAllByText(/^#|^[A-Z0-9]{6}$/, { selector: 'span[dir="ltr"]' }).map((e) => e.textContent)
    expect(order_).toEqual([label(late), label(later)])
    expect(within(cardOf(label(late))).getByText(/^Overdue/)).toBeTruthy()
    expect(within(cardOf(label(later))).queryByText(/^Overdue/)).toBeNull()
    expect(screen.queryByText(label(done), { selector: 'span[dir="ltr"]' })).toBeNull()

    await userEvent.setup().type(screen.getByRole('searchbox'), 'Karim')
    expect(screen.queryByText(label(done), { selector: 'span[dir="ltr"]' })).toBeNull()
  })

  it('shows the "pending" column only while a website order is waiting in it', async () => {
    await order('received')
    openBoard()
    await screen.findByRole('listitem', { name: /^Received/ })
    expect(screen.queryByRole('listitem', { name: /^Pending confirmation/ })).toBeNull()   // nothing can be moved into it

    const web = await order('pending', { source: 'web' })
    expect(await screen.findByRole('listitem', { name: /^Pending confirmation/ })).toBeTruthy()
    expect(column('Pending confirmation').getByText(label(web), { selector: 'span[dir="ltr"]' })).toBeTruthy()
  })

  it('offers only the moves this role may make, and never cancelling', async () => {
    const o = await order('received')
    openBoard()
    const card = within(await screen.findByText(label(o), { selector: 'span[dir="ltr"]' }).then((e) => e.closest('li')!))
    expect(card.getByRole('button', { name: `Move ${label(o)} to Printing` })).toBeTruthy()
    expect(card.queryByRole('button', { name: `Move ${label(o)} to In design` })).toBeNull()
    expect(card.queryByRole('button', { name: /to Cancelled/ })).toBeNull()
  })

  it('a receptionist sees the other move from the same stage', async () => {
    session.role = 'receptionist'
    const o = await order('received')
    openBoard()
    const card = within(await screen.findByText(label(o), { selector: 'span[dir="ltr"]' }).then((e) => e.closest('li')!))
    expect(card.getByRole('button', { name: `Move ${label(o)} to In design` })).toBeTruthy()
    expect(card.queryByRole('button', { name: `Move ${label(o)} to Printing` })).toBeNull()
  })

  it('a tap moves the order offline, queues it for the server, asks for a sync, and the card changes column', async () => {
    const o = await order('received')
    const user = userEvent.setup()
    openBoard()
    await user.click(await screen.findByRole('button', { name: `Move ${label(o)} to Printing` }))
    await vi.waitFor(async () => expect((await db.orders.get(o.id))!.status).toBe('printing'))
    expect((await db.outbox.toArray()).some((m) => m.entity === 'order_status_history')).toBe(true)
    expect(sync.requestSync).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(column('Printing').getByText(label(o), { selector: 'span[dir="ltr"]' })).toBeTruthy())
  })

  it('dragging a card onto a column moves it only when that move is allowed', async () => {
    const o = await order('received')
    openBoard()
    const card = await screen.findByText(label(o), { selector: 'span[dir="ltr"]' }).then((e) => e.closest('li')!)
    const ready = screen.getByRole('listitem', { name: /^Ready/ })
    const printing = screen.getByRole('listitem', { name: /^Printing/ })

    fireEvent.dragStart(card, dt())
    expect(fireEvent.dragOver(ready, dt())).toBe(true)          // not prevented: the browser refuses the drop
    fireEvent.drop(ready, dt())
    expect((await db.orders.get(o.id))!.status).toBe('received')

    fireEvent.dragStart(card, dt())
    expect(fireEvent.dragOver(printing, dt())).toBe(false)      // prevented: this column accepts it
    fireEvent.drop(printing, dt())
    await vi.waitFor(async () => expect((await db.orders.get(o.id))!.status).toBe('printing'))
  })

  it('when the device cannot save the move, it says so and nothing changes', async () => {
    const o = await order('received')
    const user = userEvent.setup()
    openBoard()
    const add = vi.spyOn(db.outbox, 'add').mockRejectedValueOnce(new Error('QuotaExceededError'))
    await user.click(await screen.findByRole('button', { name: `Move ${label(o)} to Printing` }))
    expect((await screen.findByRole('alert')).textContent).toBe('This order could not be moved. Nothing was changed; open it and try again.')
    expect((await db.orders.get(o.id))!.status).toBe('received')    // the write was one transaction: rolled back whole
    expect(sync.requestSync).not.toHaveBeenCalled()
    add.mockRestore()
  })
})
