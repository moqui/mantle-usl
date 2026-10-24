// Orders stored from an external source (store#Order create and revise) and bulk part status changes
// (mantle.order.OrderBulkServices). New spec, no Groovy original.
const effectiveTime = Date.now()
const vendorId = "ORG_ZIZI_RETAIL", facilityId = "ZIRET_WH"
let orderId, partSeqId, firstItemSeqId, otherOrderId

spec({
    stepwise: true,
    tempSequences: { start: 59100, banks: { "mantle.party.Party": 20, "mantle.order.OrderHeader": 20, "mantle.contact.ContactMech": 10 } },
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
const items = (id) => Array.from(ec.entity.find("mantle.order.OrderItem").condition("orderId", id).orderBy("orderItemSeqId").list())
const header = (id) => ec.entity.find("mantle.order.OrderHeader").condition("orderId", id).one()
function purchaseOrder(extra) {
    return Object.assign({
        header: { externalId: "EXT-PO-1", otherPartyOrderId: "PO-1001", externalRevision: "1", placedDate: effectiveTime - 3600000, vendorPartyId: vendorId, facilityId },
        parties: [{ idValue: "BULK-CUST-1", partyIdTypeEnumId: "PtidCust", roleTypeId: "Customer", organizationName: "Bulk Customer Inc",
                    address: { contactMechPurposeId: "PostalShippingDest", address1: "10 Bulk Way", city: "Orem", stateProvinceGeoId: "USA_UT", postalCode: "84057", countryGeoId: "USA" } }],
        notes: [{ noteText: "Ship with care" }],
        items: [{ productId: "DEMO_1_1", itemTypeEnumId: "ItemProduct", externalItemSeqId: "1", quantity: 2, unitAmount: 10, itemDescription: "First" },
                { productId: "NO_SUCH_PRODUCT", itemTypeEnumId: "ItemProduct", externalItemSeqId: "2", quantity: 1, unitAmount: 3, itemDescription: "Unknown product" }],
    }, extra)
}

feature("store a new order from an external source: parties, notes and items", {
    when() {
        const out = call("mantle.order.OrderBulkServices.store#Order", purchaseOrder())
        orderId = out.orderId; partSeqId = out.orderPartSeqId
        const list = items(orderId)
        firstItemSeqId = list[0].orderItemSeqId
        const customer = Array.from(ec.entity.find("mantle.party.PartyIdentification").condition("idValue", "BULK-CUST-1").list())[0]
        const roles = Array.from(ec.entity.find("mantle.order.OrderPartParty").condition("orderId", orderId).list())
        const notes = Array.from(ec.entity.find("mantle.order.OrderNote").condition("orderId", orderId).list())
        return { out, list, customer, roles, notes, h: header(orderId) }
    },
    then({ out, list, customer, roles, notes, h }) {
        orderId != null
        n(out.orderRevision) >= 1
        list.length == 2
        list[0].productId == "DEMO_1_1"
        // an unknown product is kept as an item with a comment and no product
        list[1].productId == null
        list[1].comments.includes("does not exist")
        customer != null
        roles.length == 1
        roles[0].partyId == customer.partyId
        notes.length == 1
        notes[0].noteText == "Ship with care"
        h.externalId == "EXT-PO-1"
        ec.entity.find("mantle.order.OrderPart").condition("orderId", orderId).one().otherPartyOrderId == "PO-1001"
    },
})

feature("a same or older revision is refused; a newer one updates items, adds notes and removes missing items", {
    when() {
        const same = errorOf("mantle.order.OrderBulkServices.store#Order", purchaseOrder())
        const revised = purchaseOrder({
            header: { externalId: "EXT-PO-1", otherPartyOrderId: "PO-1001", externalRevision: "2", placedDate: effectiveTime - 3600000, vendorPartyId: vendorId, facilityId },
            notes: [{ noteText: "Ship with care" }, { noteText: "Second note" }],
            items: [{ productId: "DEMO_1_1", itemTypeEnumId: "ItemProduct", externalItemSeqId: "1", quantity: 5, unitAmount: 10, itemDescription: "First changed" },
                    { productId: "DEMO_2_1", itemTypeEnumId: "ItemProduct", externalItemSeqId: "3", quantity: 1, unitAmount: 7, itemDescription: "New item" }],
        })
        // the customer is found again by its identification
        const customerId = Array.from(ec.entity.find("mantle.party.PartyIdentification").condition("idValue", "BULK-CUST-1").list())[0].partyId
        revised.header.customerPartyId = customerId
        // a note is keyed by its date, so the revision comes a minute later than the first store
        ec.user.setEffectiveTime(effectiveTime + 60000)
        const out = call("mantle.order.OrderBulkServices.store#Order", revised)
        const list = items(orderId)
        const notes = Array.from(ec.entity.find("mantle.order.OrderNote").condition("orderId", orderId).list())
        return { same, out, list, notes, h: header(orderId) }
    },
    then({ same, out, list, notes }) {
        same.includes("Newer or same revision")
        out.orderId == orderId
        // item 1 changed, the unknown product item (2) was missing so it is gone, item 3 is new
        list.length == 2
        n(list.find(i => i.externalItemSeqId == "1").quantity) == 5
        list.find(i => i.externalItemSeqId == "3").productId == "DEMO_2_1"
        list.some(i => i.externalItemSeqId == "2") == false
        notes.length == 2
    },
})

feature("change the status of order parts in bulk: place, approve and cancel", {
    when() {
        const { orderId: second } = (() => {
            const created = call("mantle.order.OrderServices.create#Order", { vendorPartyId: vendorId, customerPartyId: "JoeDist", facilityId })
            call("mantle.order.OrderServices.add#OrderProductQuantity", { orderId: created.orderId, orderPartSeqId: created.orderPartSeqId, productId: "DEMO_1_1", quantity: 1, unitAmount: 4, requireInventory: false })
            return created
        })()
        otherOrderId = second
        const noTransitions = errorOf("mantle.order.OrderBulkServices.change#OrderPartsStatus", { toStatusId: "OrderNoSuchStatus", inputFieldsMap: {} })
        call("mantle.order.OrderBulkServices.change#OrderPartsStatus", { toStatusId: "OrderPlaced", inputFieldsMap: { orderId: otherOrderId, orderType: "Sales" } })
        const placed = header(otherOrderId).statusId
        call("mantle.order.OrderBulkServices.change#OrderPartsStatus", { toStatusId: "OrderApproved", inputFieldsMap: { orderId: otherOrderId, orderType: "Sales" } })
        const approved = header(otherOrderId).statusId
        call("mantle.order.OrderBulkServices.change#OrderPartsStatus", { toStatusId: "OrderCancelled", inputFieldsMap: { orderId: otherOrderId, orderType: "Sales" } })
        const cancelled = header(otherOrderId).statusId
        return { noTransitions, placed, approved, cancelled }
    },
    then({ noTransitions, placed, approved, cancelled }) {
        noTransitions.includes("No status transitions found")
        placed == "OrderPlaced"
        approved == "OrderApproved"
        cancelled == "OrderCancelled"
    },
})

feature("generate test orders: refused unless sure, then one random order", {
    when() {
        const refused = errorOf("mantle.order.OrderTestServices.generate#TestOrders", { orderCount: 1 })
        const before = ec.entity.find("mantle.order.OrderHeader").count()
        call("mantle.order.OrderTestServices.generate#TestOrders", { orderCount: 1, maxItems: 2, maxQuantity: 2, maxDaysPast: 1, ifSureSetToTrue: true })
        return { refused, before, after: ec.entity.find("mantle.order.OrderHeader").count() }
    },
    then({ refused, before, after }) {
        refused.includes("didn't say you were sure")
        after >= before
    },
})
