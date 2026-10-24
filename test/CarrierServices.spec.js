// Carrier services (mantle.shipment.CarrierServices): order shipping rates through the local gateway, label markup,
// the label request, refund and track dispatch to the services a gateway config names, label info removal, package
// insurance and address validation. The gateway services named here are stand-ins that exist in the component, since the
// carrier integrations are separate components. New spec, no Groovy original.
const effectiveTime = Date.now()
const vendorId = "ORG_ZIZI_RETAIL", customerId = "JoeDist", facilityId = "ZIRET_WH", productId = "DEMO_1_2", storeId = "POPC_DEFAULT"
let orderId, partSeqId, shipmentId, packageSeqId, segmentSeqId

spec({
    stepwise: true,
    tempSequences: { start: 59400, banks: { "mantle.order.OrderHeader": 20, "mantle.product.asset.Asset": 10, "mantle.product.asset.AssetDetail": 40,
        "mantle.product.issuance.AssetReservation": 10, "mantle.shipment.Shipment": 10, "mantle.shipment.ShipmentItemSource": 10, "mantle.account.invoice.Invoice": 10,
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
const packageRouteSeg = () => ec.entity.find("mantle.shipment.ShipmentPackageRouteSeg").condition("shipmentId", shipmentId).condition("shipmentPackageSeqId", packageSeqId).one()

feature("an order for the store with a ground shipment, and a shipment with a packed package", {
    when() {
        call("mantle.product.AssetServices.receive#Asset", { productId, quantity: 20, facilityId, ownerPartyId: vendorId, assetTypeEnumId: "AstTpInventory", acquireCost: 3, receivedDate: effectiveTime })
        const created = call("mantle.order.OrderServices.create#Order", { vendorPartyId: vendorId, customerPartyId: customerId, facilityId, productStoreId: storeId })
        orderId = created.orderId; partSeqId = created.orderPartSeqId
        call("mantle.order.OrderServices.add#OrderProductQuantity", { orderId, orderPartSeqId: partSeqId, productId, quantity: 4, unitAmount: 12 })
        call("mantle.order.OrderServices.set#OrderBillingShippingInfo", { orderId, orderPartSeqId: partSeqId, shippingPostalContactMechId: "JoeDistAddr", carrierPartyId: "_NA_", shipmentMethodEnumId: "ShMthGround" })
        call("mantle.order.OrderServices.place#Order", { orderId })
        call("mantle.order.OrderServices.approve#Order", { orderId })
        const ship = call("mantle.shipment.ShipmentServices.create#OrderPartShipment", { orderId, orderPartSeqId: partSeqId, createPackage: true })
        shipmentId = ship.shipmentId; packageSeqId = ship.shipmentPackageSeqId
        call("mantle.shipment.ShipmentServices.pack#ShipmentProduct", { productId, quantity: 4, shipmentId, shipmentPackageSeqId: packageSeqId })
        segmentSeqId = Array.from(ec.entity.find("mantle.shipment.ShipmentRouteSegment").condition("shipmentId", shipmentId).list())[0].shipmentRouteSegmentSeqId
        return { ids: [orderId, shipmentId, packageSeqId, segmentSeqId] }
    },
    then({ ids }) { ids.every(id => id != null) },
})

feature("shipping for the whole order and the bulk rates through the local gateway", {
    when() {
        const whole = call("mantle.shipment.CarrierServices.calculate#OrderShipping", { orderId })
        const withGateway = call("mantle.shipment.CarrierServices.calculate#OrderShipping", { orderId, shippingGatewayConfigId: "NA_LOCAL", createOrderItem: false })
        const bulk = call("mantle.shipment.CarrierServices.get#OrderShippingRatesBulk", { orderId, orderPartSeqId: partSeqId,
                carrierShipmentMethodList: [{ carrierPartyId: "_NA_", shipmentMethodEnumId: "ShMthGround" }, { carrierPartyId: "_NA_", shipmentMethodEnumId: "ShMthNextDay" }] })
        const shippingItems = Array.from(ec.entity.find("mantle.order.OrderItem").condition("orderId", orderId).condition("itemTypeEnumId", "ItemShipping").list())
        return { whole, withGateway, bulk, shippingItems }
    },
    then({ whole, withGateway, bulk, shippingItems }) {
        whole.shippingTotal != null
        withGateway.shippingTotal != null
        bulk.shippingRateInfoList.length == 2
        bulk.shippingRateInfoList.every(r => r.carrierPartyId == "_NA_")
        shippingItems.length <= 1
    },
})

feature("label markup from the store setting and from a ship option", {
    when() {
        call("create#mantle.product.store.ProductStoreSetting", { productStoreId: storeId, settingTypeEnumId: "PsstShipLabelMarkup", fromDate: effectiveTime - 86400000, settingValue: "10" })
        const percent = call("mantle.shipment.CarrierServices.get#ShipLabelMarkup", { productStoreId: storeId, carrierPartyId: "_NA_", shipmentMethodEnumId: "ShMthGround", baseAmount: 20 })
        call("create#mantle.product.store.ProductStoreShipOption", { productStoreId: storeId, carrierPartyId: "_NA_", shipmentMethodEnumId: "ShMthSecondDay", sequenceNum: 90, markupPercent: 5, markupAmount: 1 })
        const option = call("mantle.shipment.CarrierServices.get#ShipLabelMarkup", { productStoreId: storeId, carrierPartyId: "_NA_", shipmentMethodEnumId: "ShMthSecondDay", baseAmount: 20 })
        return { percent, option }
    },
    then({ percent, option }) {
        n(percent.markupPercent) == 10
        n(percent.markupMultiplier) == 0.1
        n(percent.markedUpAmount) == 22
        // 20 + 1 + 5% of 20
        n(option.markedUpAmount) == 22
    },
})

feature("labels are requested, refunded and tracked through the gateway the route segment names", {
    when() {
        call("create#mantle.shipment.carrier.ShippingGatewayConfig", { shippingGatewayConfigId: "TEST_SHIP", shippingGatewayTypeEnumId: "ShGtwyLocal", description: "Test gateway",
                requestLabelsServiceName: "mantle.shipment.CarrierServices.remove#ShipmentLabelInfo", refundLabelsServiceName: "mantle.shipment.CarrierServices.remove#ShipmentLabelInfo",
                trackLabelsServiceName: "mantle.shipment.CarrierServices.remove#ShipmentReturnLabelInfo" })
        // the store's gateway for the carrier wins over the one on the route segment, so the segment has no carrier here
        const storeFirst = call("mantle.shipment.CarrierServices.get#ShipmentGatewayDetails", { shipmentId })
        call("update#mantle.shipment.ShipmentRouteSegment", { shipmentId, shipmentRouteSegmentSeqId: segmentSeqId, shippingGatewayConfigId: "TEST_SHIP", carrierPartyId: null })
        call("update#mantle.shipment.ShipmentPackageRouteSeg", { shipmentId, shipmentPackageSeqId: packageSeqId, shipmentRouteSegmentSeqId: segmentSeqId,
                trackingCode: "1Z-TRACK", gatewayMessage: "kept until removed", returnTrackingCode: "RET-TRACK" })
        const details = call("mantle.shipment.CarrierServices.get#ShipmentGatewayDetails", { shipmentId })
        call("mantle.shipment.CarrierServices.track#ShipmentLabels", { shipmentId, shipmentPackageSeqId: packageSeqId })
        const afterTrack = packageRouteSeg()
        call("mantle.shipment.CarrierServices.request#ShipmentLabels", { shipmentId, shipmentPackageSeqId: packageSeqId })
        const afterRequest = packageRouteSeg()
        return { storeFirst, details, afterTrack, afterRequest }
    },
    then({ storeFirst, details, afterTrack, afterRequest }) {
        storeFirst.shippingGatewayConfigId == "NA_LOCAL"
        details.shippingGatewayConfigId == "TEST_SHIP"
        details.shipmentRouteSegmentSeqId == segmentSeqId
        // track here removes the return label info; request removes all of it
        afterTrack.trackingCode == "1Z-TRACK"
        afterTrack.returnTrackingCode == null
        afterRequest.trackingCode == null
        afterRequest.gatewayMessage == null
    },
})

feature("a gateway with no service for the operation is logged and skipped; refund works", {
    when() {
        call("update#mantle.shipment.carrier.ShippingGatewayConfig", { shippingGatewayConfigId: "TEST_SHIP", trackLabelsServiceName: null })
        call("mantle.shipment.CarrierServices.track#ShipmentLabels", { shipmentId, shipmentPackageSeqId: packageSeqId })
        call("update#mantle.shipment.ShipmentPackageRouteSeg", { shipmentId, shipmentPackageSeqId: packageSeqId, shipmentRouteSegmentSeqId: segmentSeqId, trackingCode: "AGAIN" })
        call("mantle.shipment.CarrierServices.refund#ShipmentLabels", { shipmentId, shipmentPackageSeqId: packageSeqId })
        const afterRefund = packageRouteSeg()
        const returnRemoved = call("mantle.shipment.CarrierServices.remove#ShipmentReturnLabelInfo", { shipmentId, shipmentPackageSeqId: packageSeqId, shipmentRouteSegmentSeqId: segmentSeqId })
        return { afterRefund, returnRemoved }
    },
    then({ afterRefund }) {
        afterRefund.trackingCode == null
    },
})

feature("package insurance: by product flag and by the store threshold", {
    when() {
        const none = call("mantle.shipment.CarrierServices.get#ShipmentPackageRequiresInsurance", { shipmentId, shipmentPackageSeqId: packageSeqId, insurancePackageThreshold: 100000 })
        const low = call("mantle.shipment.CarrierServices.get#ShipmentPackageRequiresInsurance", { shipmentId, shipmentPackageSeqId: packageSeqId, insurancePackageThreshold: 1 })
        call("update#mantle.product.Product", { productId, shippingInsuranceReqd: "Y" })
        const flagged = call("mantle.shipment.CarrierServices.get#GeneralPackageRequiresInsurance", { quantityByProductId: { [productId]: 2 }, insurancePackageThreshold: 100000 })
        call("update#mantle.product.Product", { productId, shippingInsuranceReqd: "N" })
        return { none, low, flagged }
    },
    then({ none, low, flagged }) {
        none.insuranceRequired == false
        none.contentDescription.includes("4")
        n(none.packageTotalCost) >= 0
        flagged.insuranceRequired == true
        flagged.contentDescription.includes("2x")
    },
})

feature("address validation with no validating gateway, and the bulk count", {
    when() {
        const none = call("mantle.shipment.CarrierServices.validate#PostalAddress", { contactMechId: "JoeDistAddr", partyId: customerId })
        const withGateway = call("mantle.shipment.CarrierServices.validate#PostalAddress", { contactMechId: "JoeDistAddr", partyId: customerId, shippingGatewayConfigId: "TEST_SHIP", orderId })
        const missingGateway = call("mantle.shipment.CarrierServices.validate#PostalAddress", { contactMechId: "JoeDistAddr", partyId: customerId, shippingGatewayConfigId: "NO_SUCH_GATEWAY" })
        const bulk = call("mantle.shipment.CarrierServices.validate#PostalAddressBulk", { countOnly: true })
        return { none, withGateway, missingGateway, bulk }
    },
    then({ none, withGateway, bulk }) {
        none.contactMechId == "JoeDistAddr" || none.contactMechId == null
        withGateway.contactMechId == "JoeDistAddr" || withGateway.contactMechId == null
        n(bulk.foundNewCount) >= 0
        n(bulk.validateCount) == 0
    },
})

feature("printing labels needs a printer, and a package with no label is reported, not printed", {
    when() {
        const noPrinter = errorOf("mantle.shipment.ShipmentServices.print#ShipmentLabels", { shipmentId })
        const out = call("mantle.shipment.ShipmentServices.print#ShipmentLabels", { shipmentId, networkPrinterId: "TEST_PRINTER", makeDefaultPrinter: true })
        const returned = call("mantle.shipment.ShipmentServices.print#ShipmentLabels", { shipmentId, networkPrinterId: "TEST_PRINTER", returnLabels: true })
        return { noPrinter, out, returned, defaultPrinter: ec.user.getPreference("Shipment.networkPrinterId.default") }
    },
    then({ noPrinter, out, returned, defaultPrinter }) {
        noPrinter.includes("No networkPrinterId specified")
        !out.printJobIdList?.length
        !returned.printJobIdList?.length
        defaultPrinter == "TEST_PRINTER"
    },
})
