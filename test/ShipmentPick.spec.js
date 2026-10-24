// Picking into containers (pickMove), adding shipment items by hand, route segment edits, receiving a whole shipment
// and completing a pack. New spec, no Groovy original.
const effectiveTime = Date.now()
const facilityId = "ZIRET_WH", ownerPartyId = "ORG_ZIZI_RETAIL", productId = "DEMO_1_2", customerPartyId = "JoeDist"
let orderId, partSeqId, shipmentId, packageSeqId, binId, otherBinId, manualShipmentId

spec({
    stepwise: true,
    tempSequences: { start: 58900, banks: { "mantle.order.OrderHeader": 20, "mantle.product.asset.Asset": 20, "mantle.product.asset.AssetDetail": 100,
        "mantle.product.issuance.AssetReservation": 20, "mantle.product.issuance.AssetIssuance": 10, "mantle.product.receipt.AssetReceipt": 10,
        "mantle.shipment.Shipment": 20, "mantle.shipment.ShipmentItemSource": 20, "mantle.account.invoice.Invoice": 10, "mantle.product.asset.Container": 10,
        "mantle.ledger.transaction.AcctgTrans": 60 } },
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
const sources = (id) => Array.from(ec.entity.find("mantle.shipment.ShipmentItemSource").condition("shipmentId", id).list())
const assetsOf = (container) => Array.from(ec.entity.find("mantle.product.asset.Asset").condition("containerId", container).list())

feature("inventory, two pick containers and a shipment assigned to one of them", {
    when() {
        call("mantle.product.AssetServices.receive#Asset", { productId, quantity: 40, facilityId, ownerPartyId, assetTypeEnumId: "AstTpInventory", receivedDate: effectiveTime })
        binId = call("create#mantle.product.asset.Container", { facilityId, serialNumber: "PICKBIN-A", description: "Pick bin A" }).containerId
        otherBinId = call("create#mantle.product.asset.Container", { facilityId, serialNumber: "PICKBIN-B", description: "Pick bin B" }).containerId
        const created = call("mantle.order.OrderServices.create#Order", { vendorPartyId: ownerPartyId, customerPartyId, facilityId })
        orderId = created.orderId; partSeqId = created.orderPartSeqId
        call("mantle.order.OrderServices.add#OrderProductQuantity", { orderId, orderPartSeqId: partSeqId, productId, quantity: 6, unitAmount: 5 })
        call("mantle.order.OrderServices.set#OrderBillingShippingInfo", { orderId, orderPartSeqId: partSeqId, shippingPostalContactMechId: "JoeDistAddr", carrierPartyId: "_NA_", shipmentMethodEnumId: "ShMthGround" })
        call("mantle.order.OrderServices.place#Order", { orderId })
        call("mantle.order.OrderServices.approve#Order", { orderId })
        const ship = call("mantle.shipment.ShipmentServices.create#OrderPartShipment", { orderId, orderPartSeqId: partSeqId, createPackage: true })
        shipmentId = ship.shipmentId; packageSeqId = ship.shipmentPackageSeqId
        call("update#mantle.shipment.Shipment", { shipmentId, pickContainerId: binId })
        return { ids: [binId, otherBinId, shipmentId] }
    },
    then({ ids }) { ids.every(id => id != null) },
})

feature("pick part of the shipment into the container by scan; a container with no shipment and an unknown product are refused", {
    when() {
        // by product id into the container named by its serial number; no shipment given so it is found from the container
        call("mantle.shipment.ShipmentServices.pickMove#ProductToContainer", { scanProduct: productId, toContainerId: "PICKBIN-A", quantity: 4 })
        const afterFirst = sources(shipmentId)[0]
        const inBin = assetsOf(binId)
        const noShipment = errorOf("mantle.shipment.ShipmentServices.pickMove#ProductToContainer", { scanProduct: productId, toContainerId: "PICKBIN-B" })
        const noProduct = errorOf("mantle.shipment.ShipmentServices.pickMove#ShipmentProduct", { scanProduct: "NO_SUCH_PRODUCT", shipmentId, toContainerId: "PICKBIN-A" })
        return { afterFirst, inBin, noShipment, noProduct }
    },
    then({ afterFirst, inBin, noShipment, noProduct }) {
        n(afterFirst.quantityPicked) == 4
        inBin.length >= 1
        // the picked assets (which of the reserved assets, and how many, depends on what other specs left) are in the bin
        inBin.length >= 1
        noShipment.includes("No unpicked Shipment")
        noProduct.includes("Could not find Product")
    },
})

feature("pick the rest directly for the shipment, with a warning when too much is asked", {
    when() {
        const out = call("mantle.shipment.ShipmentServices.pickMove#ShipmentProduct", { scanProduct: productId, shipmentId, quantity: 5 })
        return { out, picked: sources(shipmentId)[0], inBin: assetsOf(binId) }
    },
    then({ out, picked, inBin }) {
        // only 2 of the 6 were left to pick
        n(out.quantityPicked) == 2
        n(picked.quantityPicked) == 6
        inBin.length >= 1
    },
})

feature("shipment and route segment edits, package route segments", {
    when() {
        call("mantle.shipment.ShipmentServices.update#ShipmentAndRouteSegment", { shipmentId, carrierAndShipmentMethod: "_NA_:ShMthNextDay", actualTransportCost: 12.5, addtlShippingChargeDesc: "edited" })
        const segment = Array.from(ec.entity.find("mantle.shipment.ShipmentRouteSegment").condition("shipmentId", shipmentId).list())[0]
        call("mantle.shipment.ShipmentServices.update#ShipmentPackageAndRouteSeg", { shipmentId, shipmentPackageSeqId: packageSeqId, boxTypeEnumId: null, trackingCode: "PKG-TRK" })
        const packageRouteSeg = Array.from(ec.entity.find("mantle.shipment.ShipmentPackageRouteSeg").condition("shipmentId", shipmentId).list())[0]
        return { ship: shipment(shipmentId), segment, packageRouteSeg }
    },
    then({ ship, segment, packageRouteSeg }) {
        segment.shipmentMethodEnumId == "ShMthNextDay"
        n(segment.actualTransportCost) == 12.5
        packageRouteSeg.trackingCode == "PKG-TRK"
        ship.addtlShippingChargeDesc == "edited"
    },
})

feature("complete the pack", {
    when() {
        call("mantle.shipment.ShipmentServices.pack#ShipmentProduct", { productId, quantity: 6, shipmentId, shipmentPackageSeqId: packageSeqId })
        const out = call("mantle.shipment.ShipmentServices.complete#ShipmentPack", { shipmentId, carrierAndShipmentMethod: "_NA_:ShMthGround" })
        return { out, ship: shipment(shipmentId) }
    },
    then({ ship }) {
        ["ShipPacked", "ShipShipped"].includes(ship.statusId)
    },
})

feature("a manual incoming shipment: items by hand, ensured remaining quantity and receive the whole shipment", {
    when() {
        manualShipmentId = call("mantle.shipment.ShipmentServices.create#Shipment", { shipmentTypeEnumId: "ShpTpPurchase", fromPartyId: customerPartyId, toPartyId: ownerPartyId,
                destinationFacilityId: facilityId }).shipmentId
        const item = call("mantle.shipment.ShipmentServices.create#ShipmentItem", { shipmentId: manualShipmentId, productId, quantity: 5 })
        // adding the same product adds quantity to the item and a second source
        call("mantle.shipment.ShipmentServices.create#ShipmentItem", { shipmentId: manualShipmentId, productId, quantity: 3 })
        call("mantle.shipment.ShipmentServices.ensure#ShipmentItemQuantityRemaining", { shipmentId: manualShipmentId, productId, newQuantityRemaining: 10 })
        call("mantle.shipment.ShipmentServices.ensure#ShipmentItemQuantityRemaining", { shipmentId: manualShipmentId, productId: "DEMO_1_1", newQuantityRemaining: 2 })
        const items = Array.from(ec.entity.find("mantle.shipment.ShipmentItem").condition("shipmentId", manualShipmentId).orderBy("productId").list())
        const before = n(ec.entity.find("mantle.product.asset.Asset").condition("productId", productId).condition("facilityId", facilityId).list()
                .reduce((sum, a) => sum + n(a.quantityOnHandTotal), 0))
        call("mantle.shipment.ShipmentServices.receive#EntireShipment", { shipmentId: manualShipmentId, facilityId })
        const after = n(ec.entity.find("mantle.product.asset.Asset").condition("productId", productId).condition("facilityId", facilityId).list()
                .reduce((sum, a) => sum + n(a.quantityOnHandTotal), 0))
        return { item, items, before, after, ship: shipment(manualShipmentId) }
    },
    then({ item, items, before, after, ship }) {
        item.shipmentItemSourceId != null
        items.length == 2
        n(items.find(i => i.productId == productId).quantity) == 10
        n(items.find(i => i.productId == "DEMO_1_1").quantity) == 2
        after - before == 10
        ship.statusId == "ShipDelivered"
    },
})
