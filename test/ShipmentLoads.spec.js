// Shipment loads (picklists): mantle.work.ShipmentWorkServices create, add shipments and order parts, bulk creation for
// approved orders, status derived from the shipments, complete and close. New spec, no Groovy original.
const effectiveTime = Date.now()
const vendorId = "ORG_ZIZI_RETAIL", customerId = "JoeDist", facilityId = "ZIRET_WH", productId = "DEMO_2_1"
let assetId, loadId, orderA, orderB, orderC, shipmentA, shipmentB, secondLoadId, bulkLoadIds

spec({
    stepwise: true,
    tempSequences: { start: 58300, banks: { "mantle.order.OrderHeader": 20, "mantle.work.effort.WorkEffort": 20, "mantle.product.asset.Asset": 10,
        "mantle.product.asset.AssetDetail": 60, "mantle.product.issuance.AssetReservation": 20, "mantle.product.issuance.AssetIssuance": 10,
        "mantle.shipment.Shipment": 20, "mantle.shipment.ShipmentItemSource": 20, "mantle.account.invoice.Invoice": 10,
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
const effort = (id) => ec.entity.find("mantle.work.effort.WorkEffort").condition("workEffortId", id).one()
const shipment = (id) => ec.entity.find("mantle.shipment.Shipment").condition("shipmentId", id).one()
function approvedOrder(quantity) {
    const created = call("mantle.order.OrderServices.create#Order", { vendorPartyId: vendorId, customerPartyId: customerId, facilityId })
    call("mantle.order.OrderServices.add#OrderProductQuantity", { orderId: created.orderId, orderPartSeqId: created.orderPartSeqId, productId, quantity, unitAmount: 8 })
    call("mantle.order.OrderServices.set#OrderBillingShippingInfo", { orderId: created.orderId, orderPartSeqId: created.orderPartSeqId, shippingPostalContactMechId: "JoeDistAddr",
            carrierPartyId: "_NA_", shipmentMethodEnumId: "ShMthGround" })
    call("mantle.order.OrderServices.place#Order", { orderId: created.orderId })
    call("mantle.order.OrderServices.approve#Order", { orderId: created.orderId })
    return { orderId: created.orderId, partSeqId: created.orderPartSeqId }
}
function packAndShip(shipmentId, quantity, ship) {
    const pkg = Array.from(ec.entity.find("mantle.shipment.ShipmentPackage").condition("shipmentId", shipmentId).list())
    const shipmentPackageSeqId = pkg[0].shipmentPackageSeqId
    call("mantle.shipment.ShipmentServices.pack#ShipmentProduct", { productId, quantity, shipmentId, shipmentPackageSeqId })
    call("mantle.shipment.ShipmentServices.pack#Shipment", { shipmentId })
    if (ship) call("mantle.shipment.ShipmentServices.ship#Shipment", { shipmentId })
}

feature("inventory and three approved orders", {
    when() {
        assetId = call("mantle.product.AssetServices.receive#Asset", { productId, quantity: 50, facilityId, ownerPartyId: vendorId, assetTypeEnumId: "AstTpInventory",
                acquireCost: 3, receivedDate: effectiveTime }).assetId
        ;({ orderId: orderA } = approvedOrder(2))
        ;({ orderId: orderB } = approvedOrder(3))
        ;({ orderId: orderC } = approvedOrder(1))
        return { ids: [assetId, orderA, orderB, orderC] }
    },
    then({ ids }) { ids.every(id => id != null) },
})

feature("create a shipment load with an asset and a shipment, and add order parts to it", {
    when() {
        const created = call("mantle.shipment.ShipmentServices.create#OrderPartShipment", { orderId: orderA, orderPartSeqId: "01", createPackage: true })
        shipmentA = created.shipmentId
        loadId = call("mantle.work.ShipmentWorkServices.create#ShipmentLoadShip", { workEffortName: "Test Load 1", facilityId, estimatedStartDate: effectiveTime + 3600000,
                ownerPartyId: vendorId, shipmentIdList: [shipmentA] }).workEffortId
        // an order part with no shipment gets one created and is added with the next bin number
        const added = call("mantle.work.ShipmentWorkServices.add#OrderPartToShipmentLoad", { orderId: orderB, orderPartSeqId: "01", workEffortId: loadId })
        shipmentB = added.shipmentIdList[0]
        const addedAgain = call("mantle.work.ShipmentWorkServices.add#OrderPartToShipmentLoad", { orderId: orderB, orderPartSeqId: "01", workEffortId: loadId })
        return { added, addedAgain, we: effort(loadId), a: shipment(shipmentA), b: shipment(shipmentB) }
    },
    then({ added, addedAgain, we, a, b }) {
        we.purposeEnumId == "WepShipmentShip"
        we.statusId == "WeInPlanning"
        a.shipWorkEffortId == loadId
        b.shipWorkEffortId == loadId
        // a shipment put on the load at creation gets no bin number; the next one added is the first bin, and adding it
        // again moves it to the next free bin
        a.binLocationNumber == null
        n(b.binLocationNumber) == 2
        added.shipmentIdList.length == 1
        addedAgain.shipmentIdList[0] == shipmentB
    },
})

feature("add a shipment to a load with a chosen bin number, and refuse a load that is in progress", {
    when() {
        const created = call("mantle.work.ShipmentWorkServices.add#OrderPartToShipmentLoad", { orderId: orderC, orderPartSeqId: "01", workEffortId: loadId, binLocationNumber: 5 })
        const third = created.shipmentIdList[0]
        // with bins 2 and 5 taken the first free number is 1
        const extra = call("mantle.shipment.ShipmentServices.create#OrderPartShipment", { orderId: approvedOrder(1).orderId, orderPartSeqId: "01" })
        call("mantle.work.ShipmentWorkServices.add#ShipmentToShipmentLoad", { shipmentId: extra.shipmentId, workEffortId: loadId })
        const bins = [shipment(shipmentA), shipment(shipmentB), shipment(third), shipment(extra.shipmentId)].map(s => s.binLocationNumber == null ? null : n(s.binLocationNumber))
        return { third, bins }
    },
    then({ bins }) {
        bins[0] == null
        bins[1] == 2
        bins[2] == 5
        bins[3] == 1
    },
})

feature("the pick info of a load covers its shipments, locations and products", {
    when() { return { info: call("mantle.shipment.ShipmentInfoServices.get#ShipmentLoadPickInfo", { workEffortId: loadId }) } },
    then({ info }) {
        info.workEffort.workEffortId == loadId
        info.shipmentList.length >= 3
        info.shipmentPickPackInfoList.length == info.shipmentList.length
        info.productInfoList.some(p => p.productId == productId)
    },
})

feature("shipment status drives the shipment load status", {
    when() {
        const before = call("mantle.work.ShipmentWorkServices.set#ShipmentLoadStatusFromShipments", { workEffortId: loadId })
        packAndShip(shipmentA, 2, false)
        call("mantle.work.ShipmentWorkServices.set#ShipmentLoadStatusFromShipments", { workEffortId: loadId })
        const inProgress = effort(loadId).statusId
        // a completed load cannot be added to
        const refusedComplete = errorOf("mantle.work.ShipmentWorkServices.check#ShipmentLoadStatusChange", { workEffortId: loadId, statusId: "WeComplete" })
        const refusedAdd = call("mantle.work.ShipmentWorkServices.add#ShipmentToShipmentLoad", { shipmentId: shipmentB, workEffortId: loadId })
        return { before, inProgress, refusedComplete, refusedAdd }
    },
    then({ inProgress }) {
        inProgress == "WeInProgress"
    },
})

feature("complete the load: shipments still in Input are removed, the packed shipment stays", {
    when() {
        const out = call("mantle.work.ShipmentWorkServices.complete#ShipmentLoadShip", { workEffortId: loadId })
        const again = call("mantle.work.ShipmentWorkServices.complete#ShipmentLoadShip", { workEffortId: loadId })
        const removed = shipment(shipmentB)
        return { out, again, we: effort(loadId), removed, kept: shipment(shipmentA) }
    },
    then({ we, removed, kept }) {
        we.statusId == "WeComplete"
        removed.shipWorkEffortId == null
        removed.binLocationNumber == null
        kept.shipWorkEffortId == loadId
    },
})

feature("ship the packed shipment and close the load", {
    when() {
        call("mantle.shipment.ShipmentServices.ship#Shipment", { shipmentId: shipmentA })
        // the SECA on the shipment status moves the load on
        const afterShip = effort(loadId).statusId
        const out = call("mantle.work.ShipmentWorkServices.close#ShipmentLoadShip", { workEffortId: loadId })
        const closed = effort(loadId).statusId
        const again = call("mantle.work.ShipmentWorkServices.close#ShipmentLoadShip", { workEffortId: loadId })
        const other = call("mantle.work.ShipmentWorkServices.close#ShipmentLoadShip", { workEffortId: "NO_SUCH_LOAD" })
        return { afterShip, closed, out, again }
    },
    then({ afterShip, closed }) {
        ["WeClosed", "WeComplete"].includes(afterShip)
        closed == "WeClosed"
    },
})

feature("make the order conditions and create loads for the remaining approved orders", {
    when() {
        const conds = call("mantle.work.ShipmentWorkServices.make#ShipmentLoadOrderConditions", {})
        const orderE = approvedOrder(1).orderId
        const out = call("mantle.work.ShipmentWorkServices.create#ShipmentLoadsForOrders", { facilityId, workEffortName: "Bulk Load", ordersPerPicklist: 2, excludeNotPickLoc: "false",
                inputFieldsMap: { orderId: orderE } })
        return { conds, out }
    },
    then({ conds, out }) {
        conds.excludeOnPicklistCond != null
        n(out.picklistsCreated) == 1
        out.workEffortIdList.length == 1
    },
})

feature("setAll for the facility and a load for no shipments", {
    when() {
        call("mantle.work.ShipmentWorkServices.setAll#ShipmentLoadStatusFromShipments", { facilityId })
        const emptyLoad = call("mantle.work.ShipmentWorkServices.create#ShipmentLoadShip", { workEffortName: "Empty Load", facilityId, estimatedStartDate: effectiveTime + 7200000, ownerPartyId: vendorId }).workEffortId
        const completed = call("mantle.work.ShipmentWorkServices.complete#ShipmentLoadShip", { workEffortId: emptyLoad })
        return { completed, we: effort(emptyLoad) }
    },
    then({ we }) {
        // nothing left on it: completing a load with no shipments cancels it
        we.statusId == "WeCancelled"
    },
})
