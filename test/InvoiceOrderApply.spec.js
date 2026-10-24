// Applying invoices to orders and shipments by hand (apply#InvoiceToOrder, apply#InvoiceToShipment and their unapply),
// invoice item details and distribution, and closing invoice items. New spec, no Groovy original.
const effectiveTime = Date.now()
const vendorId = "ORG_ZIZI_RETAIL", customerId = "JoeDist", facilityId = "ZIRET_WH", productId = "DEMO_2_1"
let orderId, partSeqId, itemSeqId, shippingSeqId, invoiceId, productInvoiceItemSeqId, shippingInvoiceItemSeqId
let shipOrderId, shipPartSeqId, shipmentId, shipInvoiceId, shipItemSeqId, sisId

spec({
    stepwise: true,
    tempSequences: { start: 58100, banks: { "mantle.order.OrderHeader": 20, "mantle.order.OrderItemBilling": 10, "mantle.account.invoice.Invoice": 10,
        "mantle.product.asset.Asset": 10, "mantle.product.asset.AssetDetail": 40, "mantle.product.issuance.AssetReservation": 10,
        "mantle.product.issuance.AssetIssuance": 10, "mantle.product.receipt.AssetReceipt": 10, "mantle.shipment.Shipment": 10,
        "mantle.shipment.ShipmentItemSource": 10, "mantle.ledger.transaction.AcctgTrans": 60, "mantle.account.invoice.InvoiceItemDetail": 10 } },
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

const n = (value) => dec(value).toNumber()
function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    return null
}
const billings = (id) => Array.from(ec.entity.find("mantle.order.OrderItemBilling").condition("invoiceId", id).orderBy("orderItemBillingId").list())
function newInvoice(toPartyId) {
    return call("mantle.account.InvoiceServices.create#Invoice", { fromPartyId: vendorId, toPartyId: toPartyId || customerId, invoiceTypeEnumId: "InvoiceSales",
            invoiceDate: effectiveTime - 3600000, currencyUomId: "USD" }).invoiceId
}
function placeOrder(quantity) {
    const created = call("mantle.order.OrderServices.create#Order", { vendorPartyId: vendorId, customerPartyId: customerId, facilityId })
    const item = call("mantle.order.OrderServices.add#OrderProductQuantity", { orderId: created.orderId, orderPartSeqId: created.orderPartSeqId, productId, quantity, unitAmount: 8 }).orderItemSeqId
    call("mantle.order.OrderServices.set#OrderBillingShippingInfo", { orderId: created.orderId, orderPartSeqId: created.orderPartSeqId, shippingPostalContactMechId: "JoeDistAddr",
            carrierPartyId: "_NA_", shipmentMethodEnumId: "ShMthGround" })
    return { orderId: created.orderId, partSeqId: created.orderPartSeqId, itemSeqId: item }
}

feature("an order with a product and a shipping item, and a matching invoice", {
    when() {
        call("mantle.product.AssetServices.receive#Asset", { productId, quantity: 20, facilityId, ownerPartyId: vendorId, assetTypeEnumId: "AstTpInventory", acquireCost: 3, receivedDate: effectiveTime })
        ;({ orderId, partSeqId, itemSeqId } = placeOrder(4))
        shippingSeqId = call("mantle.order.OrderServices.create#OrderItem", { orderId, orderPartSeqId: partSeqId, itemTypeEnumId: "ItemShipping", itemDescription: "Shipping", quantity: 1, unitAmount: 5 }).orderItemSeqId
        call("mantle.order.OrderServices.place#Order", { orderId })
        call("mantle.order.OrderServices.approve#Order", { orderId })
        invoiceId = newInvoice()
        productInvoiceItemSeqId = call("mantle.account.InvoiceServices.create#InvoiceItem", { invoiceId, itemTypeEnumId: "ItemProduct", productId, quantity: 3, amount: 8, description: "Product" }).invoiceItemSeqId
        shippingInvoiceItemSeqId = call("mantle.account.InvoiceServices.create#InvoiceItem", { invoiceId, itemTypeEnumId: "ItemShipping", quantity: 1, amount: 5, description: "Shipping" }).invoiceItemSeqId
        return { invoiceId }
    },
    then({ invoiceId }) {
        invoiceId != null
        productInvoiceItemSeqId != null
    },
})

feature("apply the invoice to the order: billing for each matching item, partial for the product", {
    when() {
        call("mantle.account.InvoiceServices.apply#InvoiceToOrder", { invoiceId, orderId, orderPartSeqId: partSeqId })
        const list = billings(invoiceId)
        // applying again adds nothing for the shipping item (fully applied) and the product has quantity left only on the order
        call("mantle.account.InvoiceServices.apply#InvoiceToOrder", { invoiceId, orderId })
        return { list, again: billings(invoiceId) }
    },
    then({ list, again }) {
        list.length == 2
        n(list.find(b => b.orderItemSeqId == itemSeqId).quantity) == 3
        n(list.find(b => b.orderItemSeqId == shippingSeqId).quantity) == 1
        again.length == 2
    },
})

feature("a second invoice takes the remaining product quantity; mismatched parties are refused", {
    when() {
        const second = newInvoice()
        call("mantle.account.InvoiceServices.create#InvoiceItem", { invoiceId: second, itemTypeEnumId: "ItemProduct", productId, quantity: 5, amount: 8, description: "Product" })
        call("mantle.account.InvoiceServices.apply#InvoiceToOrder", { invoiceId: second, orderId })
        const list = billings(second)
        const other = newInvoice("ORG_ZIZI_RETAIL")
        call("mantle.account.InvoiceServices.create#InvoiceItem", { invoiceId: other, itemTypeEnumId: "ItemProduct", productId, quantity: 1, amount: 8, description: "Product" })
        const wrongCustomer = errorOf("mantle.account.InvoiceServices.apply#InvoiceToOrder", { invoiceId: other, orderId })
        return { list, wrongCustomer }
    },
    then({ list, wrongCustomer }) {
        // 4 ordered, 3 already billed: only 1 is left though the invoice item is for 5
        list.length == 1
        n(list[0].quantity) == 1
        wrongCustomer.includes("does not match")
    },
})

feature("unapply an invoice item from the order zeroes the billing quantity", {
    when() {
        const billing = billings(invoiceId).find(b => b.orderItemSeqId == shippingSeqId)
        call("mantle.account.InvoiceServices.unapply#InvoiceItemFromOrder", { invoiceId, orderItemBillingId: billing.orderItemBillingId })
        const after = ec.entity.find("mantle.order.OrderItemBilling").condition("orderItemBillingId", billing.orderItemBillingId).one()
        return { after }
    },
    then({ after }) {
        n(after.quantity) == 0
    },
})

feature("invoice item details by facility and distribution of the quantity by facility size", {
    when() {
        const itemKey = { invoiceId, invoiceItemSeqId: productInvoiceItemSeqId }
        const noTarget = errorOf("mantle.account.InvoiceServices.create#InvoiceItemDetail", Object.assign({ quantity: 1 }, itemKey))
        const both = errorOf("mantle.account.InvoiceServices.create#InvoiceItemDetail", Object.assign({ facilityId, partyId: customerId }, itemKey))
        const facilityA = call("mantle.facility.FacilityServices.create#Facility", { facilityName: "Detail Field A", facilityTypeEnumId: "FcTpLand", ownerPartyId: vendorId, facilitySize: 30, facilitySizeUomId: "AREA_A" }).facilityId
        const facilityB = call("mantle.facility.FacilityServices.create#Facility", { facilityName: "Detail Field B", facilityTypeEnumId: "FcTpLand", ownerPartyId: vendorId, facilitySize: 10, facilitySizeUomId: "AREA_A" }).facilityId
        call("mantle.account.InvoiceServices.create#InvoiceItemDetail", Object.assign({ facilityId: facilityA }, itemKey))
        const again = call("mantle.account.InvoiceServices.create#InvoiceItemDetail", Object.assign({ facilityId: facilityA }, itemKey))
        call("mantle.account.InvoiceServices.create#InvoiceItemDetail", Object.assign({ facilityId: facilityB }, itemKey))
        const partyDetail = call("mantle.account.InvoiceServices.create#InvoiceItemDetail", Object.assign({ partyId: customerId, quantity: 0.5 }, itemKey))
        call("mantle.account.InvoiceServices.distribute#InvoiceItemDetail", itemKey)
        const details = Array.from(ec.entity.find("mantle.account.invoice.InvoiceItemDetail").condition(itemKey).list())
        return { noTarget, both, again, partyDetail, details, facilityA, facilityB }
    },
    then({ noTarget, both, again, partyDetail, details, facilityA, facilityB }) {
        noTarget.includes("Must specify one of")
        both.includes("choose only one")
        again.invoiceItemDetailId == null
        partyDetail.invoiceItemDetailId != null
        details.length == 3
        // the quantity of 3 is split 3:1 by facility size; party details are left alone
        n(details.find(d => d.facilityId == facilityA).quantity) == 2.25
        n(details.find(d => d.facilityId == facilityB).quantity) == 0.75
        n(details.find(d => d.partyId == customerId).quantity) == 0.5
    },
})

feature("update#InvoiceItemClosed and the finalized invoice", {
    when() {
        const closed = call("mantle.account.InvoiceServices.update#InvoiceItemClosed", { invoiceId, invoiceItemSeqId: shippingInvoiceItemSeqId })
        const entireOrder = errorOf("mantle.account.InvoiceServices.create#EntireOrderPartInvoice", { orderId: "NO_SUCH_ORDER", orderPartSeqId: "01" })
        return { closed, entireOrder }
    },
    then({ closed, entireOrder }) {
        closed != null
        entireOrder != null
    },
})

feature("ship an order and move its invoice between ShipmentItemSources", {
    when() {
        ({ orderId: shipOrderId, partSeqId: shipPartSeqId, itemSeqId: shipItemSeqId } = placeOrder(2))
        call("mantle.order.OrderServices.place#Order", { orderId: shipOrderId })
        call("mantle.order.OrderServices.approve#Order", { orderId: shipOrderId })
        const ship = call("mantle.shipment.ShipmentServices.create#OrderPartShipment", { orderId: shipOrderId, orderPartSeqId: shipPartSeqId, createPackage: true })
        shipmentId = ship.shipmentId
        call("mantle.shipment.ShipmentServices.pack#ShipmentProduct", { productId, quantity: 2, shipmentId, shipmentPackageSeqId: ship.shipmentPackageSeqId })
        call("mantle.shipment.ShipmentServices.pack#Shipment", { shipmentId })
        call("mantle.shipment.ShipmentServices.ship#Shipment", { shipmentId })
        const sources = Array.from(ec.entity.find("mantle.shipment.ShipmentItemSource").condition("shipmentId", shipmentId).list())
        sisId = sources[0].shipmentItemSourceId
        // the shipped status creates the sales invoice itself, so the source already has one
        const auto = sources[0].invoiceId
        if (auto) call("mantle.account.InvoiceServices.unapply#InvoiceItemFromShipment", { invoiceId: auto, shipmentItemSourceId: sisId })
        const cleared = ec.entity.find("mantle.shipment.ShipmentItemSource").condition("shipmentItemSourceId", sisId).one()
        return { sources, auto, cleared }
    },
    then({ sources, auto, cleared }) {
        sources.length == 1
        cleared.invoiceId == null
    },
})

feature("apply a manual invoice to the shipment, then unapply it", {
    when() {
        shipInvoiceId = newInvoice()
        call("mantle.account.InvoiceServices.create#InvoiceItem", { invoiceId: shipInvoiceId, itemTypeEnumId: "ItemProduct", productId, quantity: 2, amount: 8, description: "Product" })
        call("mantle.account.InvoiceServices.create#InvoiceItem", { invoiceId: shipInvoiceId, itemTypeEnumId: "ItemShipping", quantity: 1, amount: 5, description: "Shipping" })
        call("mantle.account.InvoiceServices.apply#InvoiceToShipment", { invoiceId: shipInvoiceId, shipmentId })
        const applied = ec.entity.find("mantle.shipment.ShipmentItemSource").condition("shipmentItemSourceId", sisId).one()
        const issuances = Array.from(ec.entity.find("mantle.product.issuance.AssetIssuance").condition("shipmentItemSourceId", sisId).list())
        call("mantle.account.InvoiceServices.unapply#InvoiceItemFromShipment", { invoiceId: shipInvoiceId, shipmentItemSourceId: sisId })
        const unapplied = ec.entity.find("mantle.shipment.ShipmentItemSource").condition("shipmentItemSourceId", sisId).one()
        return { applied, issuances, unapplied }
    },
    then({ applied, issuances, unapplied }) {
        applied.invoiceId == shipInvoiceId
        // the issuance keeps the invoice it was first billed on: only issuances with no invoice are filled in
        issuances.length == 1
        unapplied.invoiceId == null
    },
})
