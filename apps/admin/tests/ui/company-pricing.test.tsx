// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'admin', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null }))
vi.mock('../../src/offline/request-sync', () => ({ requestSync: vi.fn() }))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))

import { CompanyPricingPage } from '../../src/pages/companies/CompanyPricingPage'
import { NewOrderPage } from '../../src/pages/orders/NewOrderPage'
import { createCustomerLocally } from '../../src/offline/actions'
import { db } from '../../src/offline/db'
import { renderAt, resetApp } from './harness'

beforeEach(async () => { await resetApp('en'); session.role = 'admin' })

async function seed() {
  const { customer } = await createCustomerLocally({ fullName: 'Karim Saad', phone: '+96170123456', whatsappOptIn: false })
  await db.customers.update(customer.id, { customer_type: 'b2b', company_name: 'Saad Trading' })
  const productId = '018f0000-0000-7000-8000-00000000aaaa'
  await db.products.add({ id: productId, sku: 'FLY-A5', name_ar: 'منشورات A5', name_en: 'Flyers A5', unit: 'piece', base_price: '0.10' })
  await db.outbox.clear()   // only what the pricing screen itself queues is under test
  return { customer, productId }
}
const open = (id: string) => renderAt(`/customers/${id}/pricing`, [{ path: '/customers/:id/pricing', element: <CompanyPricingPage /> }])

describe('company special pricing', () => {
  it('shows the company name and starts empty', async () => {
    const { customer } = await seed()
    open(customer.id)
    expect(await screen.findByText('Saad Trading')).toBeTruthy()
    expect(await screen.findByText('No special prices yet.')).toBeTruthy()
  })

  it('finds a product, agrees a price, and lists it', async () => {
    const { customer, productId } = await seed()
    const user = userEvent.setup()
    open(customer.id)
    await user.type(await screen.findByLabelText('Find a product'), 'Flyers')
    await user.click(await screen.findByRole('button', { name: /Flyers A5/ }))
    expect(await screen.findByText('Catalogue price: 0.10 USD')).toBeTruthy()
    await user.type(screen.getByLabelText('Agreed price'), '0.07')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await vi.waitFor(async () => expect(await db.company_price_overrides.count()).toBe(1))
    expect(await screen.findByText('0.07 USD')).toBeTruthy()
    expect((await db.outbox.orderBy('clientCreatedAt').toArray())[0]!.payload).toMatchObject({ customer_id: customer.id, product_id: productId, unit_price: '0.07' })
  })

  it('refuses a second price for the same product, in plain words', async () => {
    const { customer, productId } = await seed()
    await db.company_price_overrides.add({ id: '018f0000-0000-7000-8000-00000000bbbb', customer_id: customer.id, product_id: productId, unit_price: '0.05' })
    const user = userEvent.setup()
    open(customer.id)
    await screen.findByText('0.05 USD')
    // already-priced products are excluded from the search results entirely
    await user.type(screen.getByLabelText('Find a product'), 'Flyers')
    expect(screen.queryByRole('button', { name: /Flyers A5/ })).toBeNull()
  })

  it('edits and removes an existing price', async () => {
    const { customer, productId } = await seed()
    const overrideId = '018f0000-0000-7000-8000-00000000cccc'
    await db.company_price_overrides.add({ id: overrideId, customer_id: customer.id, product_id: productId, unit_price: '0.05' })
    const user = userEvent.setup()
    open(customer.id)
    await screen.findByText('0.05 USD')
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const field = screen.getByDisplayValue('0.05')
    await user.clear(field)
    await user.type(field, '0.09')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(async () => expect((await db.company_price_overrides.get(overrideId))!.unit_price).toBe('0.09'))

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    await vi.waitFor(async () => expect(screen.queryByText('No special prices yet.')).toBeTruthy())
    expect((await db.company_price_overrides.get(overrideId))!.deleted_at).toBeTruthy()
  })

  it('a new order for that company suggests its agreed price, while another customer gets the catalogue price', async () => {
    const { customer, productId } = await seed()
    await db.company_price_overrides.add({ id: '018f0000-0000-7000-8000-00000000dddd', customer_id: customer.id, product_id: productId, unit_price: '0.06' })
    const { customer: walkIn } = await createCustomerLocally({ fullName: 'Walk In', phone: '+96170999111', whatsappOptIn: false })
    const user = userEvent.setup()
    const pick = async (name: string) => {
      await user.type(await screen.findByLabelText('Find a customer by name or phone'), name)
      await user.click(await screen.findByRole('button', { name: new RegExp(name) }))
      await user.selectOptions(await screen.findByLabelText('Add from the product list'), await screen.findByRole('option', { name: /Flyers A5/ }))
    }

    const first = renderAt('/orders/new', [{ path: '/orders/new', element: <NewOrderPage /> }])
    await pick('Karim Saad')
    expect((await screen.findByLabelText('Unit price') as HTMLInputElement).value).toBe('0.06')   // the agreed price
    first.unmount()

    renderAt('/orders/new', [{ path: '/orders/new', element: <NewOrderPage /> }])
    await pick('Walk In')
    expect((await screen.findByLabelText('Unit price') as HTMLInputElement).value).toBe('0.10')   // the catalogue's
    void walkIn
  })
})
