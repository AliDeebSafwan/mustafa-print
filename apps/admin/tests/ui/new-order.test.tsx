// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'receptionist', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null }))
vi.mock('../../src/offline/request-sync', () => ({ requestSync: vi.fn() }))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))

import { NewOrderPage } from '../../src/pages/orders/NewOrderPage'
import { createCustomerLocally, createProduct } from '../../src/offline/actions'
import { db } from '../../src/offline/db'
import { renderAt, resetApp } from './harness'

beforeEach(async () => { await resetApp('en') })
/** The page has two Cancel buttons; the customer form's comes first in the document. */
const closeForm = () => screen.getAllByRole('button', { name: 'Cancel' })[0]!
const open = () => renderAt('/orders/new', [{ path: '/orders/new', element: <NewOrderPage /> }])

describe('new order screen', () => {
  it('explains what is missing instead of failing silently, and saves nothing', async () => {
    const user = userEvent.setup()
    open()
    await user.click(screen.getByRole('button', { name: 'Save order' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Choose the customer first')
    expect(alert.textContent).toContain('Add at least one item')
    expect(await db.orders.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })

  it('takes a walk-in customer and an order from empty screen to queued work, offline', async () => {
    const user = userEvent.setup()
    open()

    await user.click(screen.getByRole('button', { name: 'New customer' }))
    await user.type(screen.getByLabelText('Name'), 'Layla Nasser')
    await user.type(screen.getByLabelText(/Phone number/), '03 123 456')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Save customer' }))
    expect(await screen.findByText('Layla Nasser')).toBeTruthy()
    expect(screen.getByText('+9613123456')).toBeTruthy()                       // normalised from what the cashier typed

    await user.type(screen.getByPlaceholderText('Item description'), 'Business cards')
    await user.clear(screen.getByLabelText('Qty'))
    await user.type(screen.getByLabelText('Qty'), '500')
    await user.type(screen.getByLabelText('Unit price'), '0.05')
    expect((await screen.findAllByText('25.00 USD')).length).toBeGreaterThanOrEqual(2)      // line total and order total

    await user.click(screen.getByRole('radio', { name: 'Delivery' }))
    await user.click(screen.getByRole('button', { name: 'Save order' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Enter the delivery address')
    await user.type(screen.getByLabelText('Address'), 'Main street')
    await user.type(screen.getByLabelText('Delivery fee'), '٢٫٥')             // typed on an Arabic keyboard
    expect((await screen.findAllByText('27.50 USD')).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Save order' }))
    expect(await screen.findByText('DETAIL PAGE')).toBeTruthy()

    const [order] = await db.orders.toArray()
    expect(order).toMatchObject({ total: '27.50', fulfillment_type: 'delivery', delivery_address: 'Main street', delivery_fee: '2.50', _pending: true })
    expect((await db.outbox.orderBy('clientCreatedAt').toArray()).map((m) => m.entity)).toEqual(['customers', 'orders'])
    expect((await db.customers.toArray())[0]).toMatchObject({ phone_e164: '+9613123456', whatsapp_opt_in: true })
  })

  it('quotes the catalogue price, and follows the quantity tiers unless the cashier types over it', async () => {
    await createProduct({
      sku: 'FLYER', name_ar: 'منشور', name_en: 'Flyer', pricing_model: 'tiered', base_price: '0.08',
      price_rules: [{ min_quantity: '100', unit_price: '0.06' }, { min_quantity: '500', unit_price: '0.04' }],
    })
    const user = userEvent.setup()
    open()
    await user.selectOptions(await screen.findByLabelText('Add from the product list'), await screen.findByRole('option', { name: /Flyer/ }))
    const price = screen.getByLabelText('Unit price') as HTMLInputElement
    expect(price.value).toBe('0.08')                                     // one unit: no tier applies

    const qty = screen.getByLabelText('Qty')
    await user.clear(qty)
    await user.type(qty, '500')
    expect((screen.getByLabelText('Unit price') as HTMLInputElement).value).toBe('0.04')
    expect((await screen.findAllByText('20.00 USD')).length).toBeGreaterThan(0)

    await user.clear(screen.getByLabelText('Unit price'))
    await user.type(screen.getByLabelText('Unit price'), '0.03')        // a deal the manager agreed
    await user.clear(screen.getByLabelText('Qty'))
    await user.type(screen.getByLabelText('Qty'), '1000')
    expect((screen.getByLabelText('Unit price') as HTMLInputElement).value).toBe('0.03')   // left exactly as typed
  })

  it('stops a discount larger than the shop allows, and lets a manager through', async () => {
    session.maxDiscountPercent = 10
    const user = userEvent.setup()
    const fillOrder = async () => {
      await user.click(screen.getByRole('button', { name: 'New customer' }))
      await user.type(screen.getByLabelText('Name'), 'Layla')
      await user.type(screen.getByLabelText(/Phone number/), '03 123 456')
      await user.click(screen.getByRole('button', { name: 'Save customer' }))
      await user.type(await screen.findByPlaceholderText('Item description'), 'Cards')
      await user.type(screen.getByLabelText('Unit price'), '100')
      await user.type(screen.getByLabelText('Order discount'), '15')
    }

    const view = open()
    await fillOrder()
    await user.click(screen.getByRole('button', { name: 'Save order' }))
    expect((await screen.findByRole('alert')).textContent).toContain('more than the shop allows (10%)')
    expect(await db.orders.count()).toBe(0)

    view.unmount()
    session.role = 'admin'
    await resetApp('en')
    open()
    await fillOrder()
    await user.click(screen.getByRole('button', { name: 'Save order' }))
    expect(await screen.findByText('DETAIL PAGE')).toBeTruthy()
    expect((await db.orders.toArray())[0]).toMatchObject({ total: '85.00' })
    session.role = 'receptionist'
    session.maxDiscountPercent = null
  })

  it('finds an existing customer by any part of the phone and never duplicates one', async () => {
    const { customer } = await createCustomerLocally({ fullName: 'Omar Khoury', phone: '+96176555444', whatsappOptIn: false })
    const user = userEvent.setup()
    open()
    await user.type(screen.getByPlaceholderText('Find a customer by name or phone'), '555')
    await user.click(await screen.findByRole('button', { name: /Omar Khoury/ }))
    expect(await screen.findByRole('button', { name: 'Change' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Change' }))
    await user.click(screen.getByRole('button', { name: 'New customer' }))
    await user.type(screen.getByLabelText('Name'), 'Omar again')
    await user.type(screen.getByLabelText(/Phone number/), '76 555 444')
    await user.click(screen.getByRole('button', { name: 'Save customer' }))
    await waitFor(async () => expect(await db.customers.count()).toBe(1))       // same phone: the existing customer was chosen
    expect(await db.outbox.count()).toBe(1)
    expect((await db.customers.toArray())[0]!.id).toBe(customer.id)
  })

  it('carries what was searched into the new-customer form: a name stays a name, a number stays a number', async () => {
    const user = userEvent.setup()
    open()
    const search = screen.getByPlaceholderText('Find a customer by name or phone')

    await user.type(search, 'Rana Haddad')                                   // long text, but not a phone number
    await user.click(screen.getByRole('button', { name: 'New customer' }))
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Rana Haddad')
    expect((screen.getByLabelText(/Phone number/) as HTMLInputElement).value).toBe('')
    await user.click(closeForm())

    await user.clear(screen.getByPlaceholderText('Find a customer by name or phone'))
    await user.type(screen.getByPlaceholderText('Find a customer by name or phone'), '٧٦ 555 444')
    await user.click(screen.getByRole('button', { name: 'Register a new customer with this number' }))
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/Phone number/) as HTMLInputElement).value).toBe('٧٦ 555 444')
    await user.click(closeForm())

    await user.clear(screen.getByPlaceholderText('Find a customer by name or phone'))
    await user.type(screen.getByPlaceholderText('Find a customer by name or phone'), '555')       // too short to be a whole number
    await user.click(screen.getByRole('button', { name: 'New customer' }))
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('')
  })

  it('rejects a phone number that cannot be real', async () => {
    const user = userEvent.setup()
    open()
    await user.click(screen.getByRole('button', { name: 'New customer' }))
    await user.type(screen.getByLabelText('Name'), 'X')
    await user.type(screen.getByLabelText(/Phone number/), '12')
    await user.click(screen.getByRole('button', { name: 'Save customer' }))
    expect((await screen.findByRole('alert')).textContent).toBe('That phone number is not valid')
    expect(await db.customers.count()).toBe(0)
  })
})
