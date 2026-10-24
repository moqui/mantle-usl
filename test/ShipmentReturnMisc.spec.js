// Shipment packages, picking, info and return services the flows do not reach: a sales order is shipped from inventory
// received here, then returned, cancelled, resold. New spec, no Groovy original.
const effectiveTime = Date.now()
const facilityId = "ZIRET_WH", ownerPartyId = "ORG_ZIZI_RETAIL", productId = "DEMO_3_1", customerPartyId = "JoeDist"
let orderId, partSeqId, itemSeqId, shipmentId, packageSeqId, returnId, returnItemSeqId, returnShipmentId

spec({
    dependsOn: ["OrderToCashBasicFlow"],
    stepwise: true,
    tempSequences: { start: 57700, banks: { "mantle.order.OrderHeader": 30, "mantle.product.asset.Asset": 20, "mantle.product.asset.AssetDetail": 100,
        "mantle.product.issuance.AssetReservation": 20, "mantle.product.issuance.AssetIssuance": 20, "mantle.product.receipt.AssetReceipt": 10,
        "mantle.shipment.Shipment": 20, "mantle.shipment.ShipmentItemSource": 20, "mantle.account.invoice.Invoice": 20,
        "mantle.order.return.ReturnHeader": 10, "mantle.account.payment.Payment": 20, "mantle.ledger.transaction.AcctgTrans": 80 } },
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
const shipment = (id) => ec.entity.find("mantle.shipment.Shipment").condition("shipmentId", id).one()
function approvedOrder(quantity) {
    const created = call("mantle.order.OrderServices.create#Order", { vendorPartyId: ownerPartyId, customerPartyId, facilityId })
    const item = call("mantle.order.OrderServices.add#OrderProductQuantity", { orderId: created.orderId, orderPartSeqId: created.orderPartSeqId, productId, quantity, unitAmount: 5 })
    call("mantle.order.OrderServices.set#OrderBillingShippingInfo", { orderId: created.orderId, orderPartSeqId: created.orderPartSeqId, shippingPostalContactMechId: "JoeDistAddr", carrierPartyId: "_NA_", shipmentMethodEnumId: "ShMthGround" })
    call("mantle.order.OrderServices.place#Order", { orderId: created.orderId })
    call("mantle.order.OrderServices.approve#Order", { orderId: created.orderId })
    return { orderId: created.orderId, partSeqId: created.orderPartSeqId, itemSeqId: item.orderItemSeqId }
}

feature("receive inventory and create an order shipment with a package", {
    when() {
        call("mantle.product.AssetServices.receive#Asset", { productId, quantity: 60, facilityId, ownerPartyId, assetTypeEnumId: "AstTpInventory", receivedDate: effectiveTime })
        ;({ orderId, partSeqId, itemSeqId } = approvedOrder(10))
        const created = call("mantle.shipment.ShipmentServices.create#OrderPartShipment", { orderId, orderPartSeqId: partSeqId, createPackage: true })
        shipmentId = created.shipmentId; packageSeqId = created.shipmentPackageSeqId
        return { created, display: call("mantle.shipment.ShipmentInfoServices.get#ShipmentDisplayInfo", { shipmentId }) }
    },
    then({ created, display }) {
        shipmentId != null
        packageSeqId != null
        display.shipmentId == shipmentId
        display.isOutgoing == true
    },
})

feature("pack by item, by scan and by item source, add to and reset a package", {
    when() {
        const first = call("mantle.shipment.ShipmentServices.pack#ShipmentProduct", { productId, quantity: 3, shipmentId, shipmentPackageSeqId: packageSeqId })
        const scanned = call("mantle.shipment.ShipmentServices.get#ShipmentProductByScan", { shipmentId, scanInput: productId })
        call("mantle.shipment.ShipmentServices.pack#ShipmentProductScan", { shipmentId, scanInput: productId, shipmentPackageSeqId: packageSeqId, quantity: 2 })
        const content = Array.from(ec.entity.find("mantle.shipment.ShipmentPackageContent").condition("shipmentId", shipmentId).list())
        const secondPackage = call("mantle.shipment.ShipmentServices.create#ShipmentPackage", { shipmentId }).shipmentPackageSeqId
        const sources = Array.from(ec.entity.find("mantle.shipment.ShipmentItemSource").condition("shipmentId", shipmentId).list())
        call("mantle.shipment.ShipmentServices.pack#ShipmentItemSource", { shipmentItemSourceId: sources[0].shipmentItemSourceId, shipmentPackageSeqId: secondPackage, quantity: 1 })
        call("mantle.shipment.ShipmentServices.update#ShipmentPackageContent", { shipmentId, productId, shipmentPackageSeqId: secondPackage, quantity: 2 })
        call("mantle.shipment.ShipmentServices.reset#ShipmentPackage", { shipmentId, shipmentPackageSeqId: secondPackage })
        call("mantle.shipment.ShipmentServices.delete#ShipmentPackage", { shipmentId, shipmentPackageSeqId: secondPackage })
        const left = Array.from(ec.entity.find("mantle.shipment.ShipmentPackage").condition("shipmentId", shipmentId).list()).length
        return { first, scanned, content: content.length, left }
    },
    then({ first, scanned, content, left }) {
        first != null
        scanned.productId == productId
        content >= 1
        left == 1
    },
})

feature("package weight and box quantity conversions run", {
    when() {
        const weight = call("mantle.shipment.ShipmentServices.get#ShipmentPackageWeight", { shipmentId, shipmentPackageSeqId: packageSeqId })
        const box = errorOf("mantle.shipment.ShipmentServices.convert#ProductBoxQuantity", { productId, originalQuantity: 5 })
        const contact = call("mantle.shipment.ShipmentInfoServices.get#ShipmentContactInfo", { shipmentId })
        const options = call("mantle.shipment.ShipmentInfoServices.get#ShipmentShippingOptions", { shipmentId })
        const pickPack = call("mantle.shipment.ShipmentInfoServices.get#ShipmentPickPackInfo", { shipmentId })
        return { weight, box, contact, options, pickPack }
    },
    then({ weight, box, contact, options, pickPack }) {
        weight != null
        box.includes("no amountUomId")
        contact.shipment.shipmentId == shipmentId
        options != null
        pickPack.shipment.shipmentId == shipmentId
    },
})

feature("pack the rest, ship, and add content", {
    when() {
        call("mantle.shipment.ShipmentServices.pack#ShipmentProduct", { productId, quantity: 5, shipmentId, shipmentPackageSeqId: packageSeqId })
        call("mantle.shipment.ShipmentServices.pack#Shipment", { shipmentId })
        call("mantle.shipment.ShipmentServices.ship#Shipment", { shipmentId })
        const shipped = shipment(shipmentId).statusId
        // no ShipmentContentType enumeration type is seeded
        call("create#moqui.basic.EnumerationType", { enumTypeId: "ShipmentContentType", description: "Shipment Content Type" })
        call("create#moqui.basic.Enumeration", { enumId: "ShcntTestBol", enumTypeId: "ShipmentContentType", description: "Bill of lading" })
        const contentId = call("mantle.shipment.ShipmentServices.create#ShipmentContent", { shipmentId, shipmentContentTypeEnumId: "ShcntTestBol", description: "bol" }).shipmentContentId
        call("mantle.shipment.ShipmentServices.update#ShipmentContent", { shipmentContentId: contentId, description: "bol edited" })
        const shFileId = call("mantle.shipment.ShipmentServices.create#ShipmentContent", { shipmentId, shipmentContentTypeEnumId: "ShcntTestBol", contentFile: uploadedFile("bol.txt", "bol text") }).shipmentContentId
        call("mantle.shipment.ShipmentServices.update#ShipmentContent", { shipmentContentId: shFileId, contentFile: uploadedFile("bol2.txt", "bol text 2") })
        return { shipped, contentId }
    },
    then({ shipped, contentId }) {
        shipped == "ShipShipped"
        contentId != null
    },
})

feature("return the shipment: returnable items, display info, item edits and cancel", {
    when() {
        const returnable = call("mantle.order.ReturnServices.create#Return", { vendorPartyId: ownerPartyId, customerPartyId, facilityId })
        returnId = returnable.returnId
        const items = call("mantle.order.ReturnServices.find#ReturnableOrderItems", { returnId })
        const open = call("mantle.order.ReturnServices.find#OrderOpenReturns", { orderId, orderPartSeqId: partSeqId })
        returnItemSeqId = call("mantle.order.ReturnServices.add#OrderItemToReturn", { returnId, orderId, orderItemSeqId: itemSeqId, returnQuantity: 4, returnReasonEnumId: "RrsnDefective", returnResponseEnumId: "RrspRefund" }).returnItemSeqId
        call("mantle.order.ReturnServices.update#ReturnItem", { returnId, returnItemSeqId, returnQuantity: 3 })
        const display = call("mantle.order.ReturnServices.get#ReturnDisplayInfo", { returnId })
        const second = call("mantle.order.ReturnServices.add#OrderItemToReturn", { returnId, orderId, orderItemSeqId: itemSeqId, returnQuantity: 1, returnReasonEnumId: "RrsnDefective", returnResponseEnumId: "RrspRefund" }).returnItemSeqId
        call("mantle.order.ReturnServices.cancel#ReturnItem", { returnId, returnItemSeqId: second })
        call("mantle.order.ReturnServices.delete#ReturnItem", { returnId, returnItemSeqId: second })
        const cancelled = call("mantle.order.ReturnServices.cancel#Return", { returnId })
        return { items, open, display, cancelled }
    },
    then({ items, open, display, cancelled }) {
        items.orderItemInfoList.length >= 1
        open.openReturnList != null
        display.returnHeader.returnId == returnId
        cancelled.statusId == "ReturnCancelled"
    },
})

feature("receive a return without a shipment, and return a whole shipment in one call", {
    when() {
        const loose = call("mantle.order.ReturnServices.create#ReturnFromOrder", { orderId, orderPartSeqId: partSeqId })
        call("mantle.order.ReturnServices.add#OrderItemToReturn", { returnId: loose.returnId, orderId, orderItemSeqId: itemSeqId, returnQuantity: 1, returnReasonEnumId: "RrsnDidNotWant", returnResponseEnumId: "RrspCredit" })
        call("mantle.order.ReturnServices.request#Return", { returnId: loose.returnId })
        call("mantle.order.ReturnServices.approve#Return", { returnId: loose.returnId })
        call("mantle.order.ReturnServices.receive#ReturnWithoutShipment", { returnId: loose.returnId })
        const looseStatus = ec.entity.find("mantle.order.return.ReturnHeader").condition("returnId", loose.returnId).one().statusId

        const other = approvedOrder(3)
        const created = call("mantle.shipment.ShipmentServices.create#OrderPartShipment", { orderId: other.orderId, orderPartSeqId: other.partSeqId, createPackage: true })
        returnShipmentId = created.shipmentId
        call("mantle.shipment.ShipmentServices.pack#ShipmentProduct", { productId, quantity: 3, shipmentId: returnShipmentId, shipmentPackageSeqId: created.shipmentPackageSeqId })
        call("mantle.shipment.ShipmentServices.pack#Shipment", { shipmentId: returnShipmentId })
        call("mantle.shipment.ShipmentServices.ship#Shipment", { shipmentId: returnShipmentId })
        const out = call("mantle.order.ReturnServices.return#Shipment", { shipmentId: returnShipmentId, returnReasonEnumId: "RrsnDefective", returnResponseEnumId: "RrspRefund" })
        const header = ec.entity.find("mantle.order.return.ReturnHeader").condition("returnId", out.returnId).one()
        return { looseStatus, out, header }
    },
    then({ looseStatus, out, header }) {
        looseStatus != "ReturnCreated"
        out.returnId != null
        header.returnId == out.returnId
    },
})

feature("resell a shipment to another customer", {
    when() {
        // resell#Shipment (as in mantle-usl upstream) never places or approves the order it creates, so there is nothing to
        // ship on it and the move of the issuances to the new shipment fails; the checks above it do run
        const res = errorOf("mantle.order.ReturnServices.resell#Shipment", { shipmentId: returnShipmentId, customerPartyId: "CustJqp" })
        return { res }
    },
    then({ res }) {
        res.includes("Field cannot be empty(for field New Shipment")
    },
})

feature("deliver the shipment, then cancel another shipment", {
    when() {
        call("mantle.shipment.ShipmentServices.deliver#Shipment", { shipmentId })
        call("mantle.shipment.ShipmentServices.checkSet#ShipmentDeliveredByPackages", { shipmentId })
        const delivered = shipment(shipmentId).statusId
        const second = approvedOrder(2)
        const created = call("mantle.shipment.ShipmentServices.create#OrderPartShipment", { orderId: second.orderId, orderPartSeqId: second.partSeqId, createPackage: true })
        call("mantle.shipment.ShipmentServices.pack#ShipmentProduct", { productId, quantity: 2, shipmentId: created.shipmentId, shipmentPackageSeqId: created.shipmentPackageSeqId })
        call("mantle.shipment.ShipmentServices.reduce#QuantitiesToHandled", { shipmentId: created.shipmentId })
        call("mantle.shipment.ShipmentServices.cancel#Shipment", { shipmentId: created.shipmentId })
        return { delivered, status: shipment(created.shipmentId).statusId }
    },
    then({ delivered, status }) {
        delivered == "ShipDelivered"
        status == "ShipCancelled"
    },
})
