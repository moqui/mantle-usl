// Communication events, requests, sales accounts and contacts, party duplicates, and equipment maintenance: services no
// flow reaches. New spec, no Groovy original.
const effectiveTime = Date.now()
let personId, accountId, contactId, requestId, messageId, equipmentId, productMaintenanceId

spec({
    stepwise: true,
    tempSequences: { start: 57400, banks: { "mantle.party.Party": 30, "mantle.request.Request": 10, "mantle.party.communication.CommunicationEvent": 20,
        "mantle.product.asset.Asset": 10, "mantle.product.maintenance.AssetMaintenance": 10, "mantle.party.contact.ContactMech": 30 } },
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

const n = (value) => dec(value).toNumber()
const cev = (id) => ec.entity.find("mantle.party.communication.CommunicationEvent").condition("communicationEventId", id).one()

feature("sales accounts and contacts", {
    when() {
        accountId = call("mantle.sales.AccountServices.create#Account", { organizationName: "CRM Account", roleTypeId: "Account" }).partyId
        contactId = call("mantle.sales.AccountServices.create#Contact", { firstName: "Connie", lastName: "Contact", accountPartyId: accountId }).partyId
        personId = call("mantle.party.PartyServices.create#Person", { firstName: "Pete", lastName: "Person" }).partyId
        call("mantle.sales.AccountServices.add#Contact", { partyId: personId, accountPartyId: accountId })
        const rels = Array.from(ec.entity.find("mantle.party.PartyRelationship").condition("toPartyId", accountId).condition("relationshipTypeEnumId", "PrtContact").list())
        const delId = rels.find(r => r.fromPartyId == personId).partyRelationshipId
        call("mantle.sales.AccountServices.delete#Contact", { partyRelationshipId: delId })
        const left = Array.from(ec.entity.find("mantle.party.PartyRelationship").condition("toPartyId", accountId).condition("relationshipTypeEnumId", "PrtContact").condition("thruDate", null).list())
        return { rels: rels.length, left: left.map(r => r.fromPartyId) }
    },
    then({ rels, left }) {
        rels == 2
        left.includes(contactId)
        !left.includes(personId)
    },
})

feature("messages, replies and finding communication events", {
    when() {
        messageId = call("mantle.party.CommunicationServices.create#Message", { fromPartyId: personId, toPartyId: contactId, subject: "Hello", body: "First message", purposeEnumId: "CpComment" }).communicationEventId
        const reply = call("mantle.party.CommunicationServices.reply#CommunicationEvent", { parentCommEventId: messageId, fromPartyId: contactId, subject: "Re: Hello", body: "Reply" })
        // the default type list "Email,Message,Comment" is also read as an equality by search-form-inputs, so a type is passed, as the screens do
        const found = call("mantle.party.CommunicationServices.find#PartyCommunicationEvents", { partyId: contactId, communicationEventTypeId: "Message" })
        const contentId = call("mantle.party.CommunicationServices.create#CommunicationEventContent", { communicationEventId: messageId, communicationContentTypeEnumId: "CecOther", description: "att" }).communicationEventContentId
        call("mantle.party.CommunicationServices.update#CommunicationEventContent", { communicationEventContentId: contentId, description: "att edited" })
        call("mantle.party.CommunicationServices.get#CommunicationEventContentLocation", { communicationEventId: messageId, contentTypeEnumIdList: ["CecOther"] })
        const commFileId = call("mantle.party.CommunicationServices.create#CommunicationEventContent", { communicationEventId: messageId, communicationContentTypeEnumId: "CecOther", contentFile: uploadedFile("mail.txt", "attachment") }).communicationEventContentId
        call("mantle.party.CommunicationServices.update#CommunicationEventContent", { communicationEventContentId: commFileId, contentFile: uploadedFile("mail2.txt", "attachment 2") })
        return { reply, found, contentId, parent: cev(reply.communicationEventId) }
    },
    then({ reply, found, contentId, parent }) {
        messageId != null
        reply.communicationEventId != messageId
        parent.parentCommEventId == messageId
        found.commEventList.length >= 1
        contentId != null
    },
})

feature("requests: create, update, comment, replace a party, and a contact request", {
    when() {
        requestId = call("mantle.request.RequestServices.create#Request", { requestName: "Support please", description: "Broken thing", customerPartyId: accountId, assignToPartyId: contactId }).requestId
        call("mantle.request.RequestServices.update#Request", { requestId, priority: 2, requestName: "Support now" })
        const added = call("mantle.request.RequestServices.add#RequestComment", { requestId, subject: "Note", body: "Looking" })
        const comments = Array.from(ec.entity.find("mantle.request.RequestCommEvent").condition("requestId", requestId).list())
        const commId = comments[0].communicationEventId
        // the new comment's id comes back (Chatter shows it at once)
        assert(added.communicationEventId === commId, `add#RequestComment answered ${added.communicationEventId}, the join has ${commId}`)
        call("mantle.request.RequestServices.update#RequestComment", { requestId, communicationEventId: commId, subject: "Note 2", body: "Fixed" })
        const edited = cev(commId)
        call("mantle.request.RequestServices.delete#RequestComment", { requestId, communicationEventId: commId })
        const left = ec.entity.find("mantle.request.RequestCommEvent").condition("requestId", requestId).count()
        call("mantle.request.RequestServices.replace#RequestParty", { requestId, roleTypeId: "Assignee", newPartyId: personId })
        const parties = Array.from(ec.entity.find("mantle.request.RequestParty").condition("requestId", requestId).condition("roleTypeId", "Assignee").condition("thruDate", null).list())
        const contentId = call("mantle.request.RequestServices.create#RequestContent", { requestId, requestContentTypeEnumId: "RqctAttachment", description: "file" }).requestContentId
        call("mantle.request.RequestServices.update#RequestContent", { requestContentId: contentId, description: "file edited" })
        call("mantle.request.RequestServices.get#RequestContentLocation", { requestId, contentTypeEnumIdList: ["RqctAttachment"] })
        const reqFileId = call("mantle.request.RequestServices.create#RequestContent", { requestId, requestContentTypeEnumId: "RqctAttachment", contentFile: uploadedFile("req.txt", "details") }).requestContentId
        call("mantle.request.RequestServices.update#RequestContent", { requestContentId: reqFileId, contentFile: uploadedFile("req2.txt", "details 2") })
        const contact = call("mantle.request.RequestServices.create#ContactRequest", { requestName: "Contact us", description: "Question", firstName: "Web", lastName: "Visitor", emailAddress: "visitor@example.com" })
        return { request: ec.entity.find("mantle.request.Request").condition("requestId", requestId).one(), comments: comments.length, edited, left, parties, contentId, contact }
    },
    then({ request, comments, edited, left, parties, contentId, contact }) {
        request.requestName == "Support now"
        n(request.priority) == 2
        comments == 1
        edited.subject == "Note 2"
        left == 0
        parties.length == 1
        parties[0].partyId == personId
        contentId != null
        contact.requestId != null
    },
})

feature("duplicate party detection and merge", {
    when() {
        const addr = { address1: "77 Dup Way", city: "Orem", stateProvinceGeoId: "USA_UT", postalCode: "84057", countryGeoId: "USA", postalContactMechPurposeId: "PostalPrimary",
                emailContactMechPurposeId: "EmailPrimary", emailAddress: "dupe." + effectiveTime + "@example.com" }
        const a = call("mantle.party.PartyServices.create#Person", { firstName: "Dupe", lastName: "One" }).partyId
        const b = call("mantle.party.PartyServices.create#Person", { firstName: "Dupe", lastName: "Two" }).partyId
        for (const partyId of [a, b]) call("mantle.party.ContactServices.store#PartyContactInfo", Object.assign({ partyId }, addr))
        const has = call("mantle.party.DuplicateServices.find#PartyHasDuplicates", { partyId: a })
        const dups = call("mantle.party.DuplicateServices.find#PartyDuplicates", { partyId: a })
        const addrs = call("mantle.party.DuplicateServices.find#PostalAddresses", { partyId: a, address1: "77 Dup Way", postalCode: "84057" })
        call("mantle.party.PartyServices.set#PartyClassification", { partyId: b, partyClassificationId: "CustDistributor" })
        call("mantle.party.DuplicateServices.merge#Parties", { toPartyId: a, fromPartyId: b })
        const movedClass = Array.from(ec.entity.find("mantle.party.PartyClassificationAppl").condition("partyId", a).condition("partyClassificationId", "CustDistributor").list()).length
        const fromParty = ec.entity.find("mantle.party.Party").condition("partyId", b).one()
        // a pair of the spec's own for the bulk merge, and a pair it leaves out of the list it gives the merge
        const withEmail = (firstName, lastName, emailAddress) => {
            const partyId = call("mantle.party.PartyServices.create#Person", { firstName, lastName }).partyId
            call("mantle.party.ContactServices.create#EmailAddress", { partyId, emailAddress, contactMechPurposeId: "EmailPrimary" })
            return partyId
        }
        const c = withEmail("Dupe", "Three", "dupe.pair." + effectiveTime + "@example.com")
        const d = withEmail("Dupe", "Four", "dupe.pair." + effectiveTime + "@example.com")
        const e = withEmail("Dupe", "Five", "dupe.outside." + effectiveTime + "@example.com")
        const f = withEmail("Dupe", "Six", "dupe.outside." + effectiveTime + "@example.com")
        const party = (partyId) => ec.entity.find("mantle.party.Party").condition("partyId", partyId).one()
        call("mantle.party.DuplicateServices.check#AllPartyDuplicates", {})
        const flagged = [c, d, e, f].map((partyId) => party(partyId).hasDuplicates)
        // only the spec's own parties: a full run's demo data from other components, flagged by the scan, is not merged
        call("mantle.party.DuplicateServices.merge#AllDuplicateParties", { partyIdList: [a, c, d] })
        const pair = [c, d].map((partyId) => party(partyId))
        const outside = [e, f].map((partyId) => party(partyId))
        return { has, dups, addrs, movedClass, fromParty, flagged, pair, outside, c, d }
    },
    then({ has, dups, addrs, movedClass, fromParty, flagged, pair, outside, c, d }) {
        has.hasDuplicates == true
        Object.keys(dups.matchingInfoByPartyId).length >= 1
        addrs.postalAddressList.length >= 1
        movedClass == 1
        fromParty == null || fromParty.disabled == "Y" || fromParty.mergedToPartyId != null
        flagged == ["Y", "Y", "Y", "Y"]
        // one of the pair merged into the other, the pair outside the list left as it was
        pair.map((party) => party.disabled).sort() == ["N", "Y"]
        pair.find((party) => party.disabled == "Y").mergedToPartyId == (pair[0].disabled == "Y" ? d : c)
        outside.map((party) => `${party.disabled}:${party.mergedToPartyId ?? ""}:${party.hasDuplicates}`) == ["N::Y", "N::Y"]
    },
})

feature("equipment and maintenance", {
    when() {
        equipmentId = call("mantle.product.EquipmentServices.create#Equipment", { assetName: "Test Press", ownerPartyId: "ORG_ZIZI_RETAIL", productId: "EQUIP_1" }).assetId
        // no MaintenanceType enumerations are seeded
        call("create#moqui.basic.Enumeration", { enumId: "MtTestOil", enumTypeId: "MaintenanceType", description: "Oil change" })
        productMaintenanceId = call("create#mantle.product.maintenance.ProductMaintenance", { productId: "EQUIP_1", maintenanceTypeEnumId: "MtTestOil", description: "Oil change", intervalQuantity: 500 }).productMaintenanceId
        const before = call("mantle.product.EquipmentServices.get#AssetMaintenanceNeeded", { assetId: equipmentId, productMaintenanceId })
        const maint = call("mantle.product.EquipmentServices.create#AssetMaintenance", { assetId: equipmentId, productMaintenanceId, intervalQuantity: 500, comments: "done" })
        // no enumeration is seeded for the content type of a maintenance record
        if (!ec.entity.find("moqui.basic.EnumerationType").condition("enumTypeId", "AssetMaintContentType").one()) call("create#moqui.basic.EnumerationType", { enumTypeId: "AssetMaintContentType", description: "Asset Maintenance Content Type" })
        if (!ec.entity.find("moqui.basic.Enumeration").condition("enumId", "AmctOther").one()) call("create#moqui.basic.Enumeration", { enumId: "AmctOther", description: "Other", enumTypeId: "AssetMaintContentType" })
        const maintContent = call("mantle.product.EquipmentServices.create#AssetMaintenanceContent", { assetMaintenanceId: maint.assetMaintenanceId, contentTypeEnumId: "AmctOther", description: "photo" })
        call("mantle.product.EquipmentServices.update#AssetMaintenanceContent", { assetMaintenanceId: maint.assetMaintenanceId, contentDate: maintContent.contentDate, description: "photo edited" })
        // the content is keyed by its date, so the second one comes a moment later
        ec.user.setEffectiveTime(effectiveTime + 5000)
        const maintFile = call("mantle.product.EquipmentServices.create#AssetMaintenanceContent", { assetMaintenanceId: maint.assetMaintenanceId, contentTypeEnumId: "AmctOther", contentFile: uploadedFile("maint.txt", "log") })
        call("mantle.product.EquipmentServices.update#AssetMaintenanceContent", { assetMaintenanceId: maint.assetMaintenanceId, contentDate: maintFile.contentDate, contentFile: uploadedFile("maint2.txt", "log 2") })
        ec.user.setEffectiveTime(effectiveTime)
        const after = call("mantle.product.EquipmentServices.get#AssetMaintenanceNeeded", { assetId: equipmentId, productMaintenanceId })
        return { before, maint, after }
    },
    then({ before, maint, after }) {
        equipmentId != null
        n(before.nextMaintenanceInterval) == 500
        maint.assetMaintenanceId != null
        n(after.nextMaintenanceInterval) == 1000
        after.lastAssetMaintenance != null
    },
})

feature("create purchase orders from a request, one for each supplier", {
    when() {
        const warehouse = "ZIRET_WH"
        const supplierA = call("mantle.party.PartyServices.create#Organization", { organizationName: "Request Supplier A", roleTypeId: "Supplier" }).partyId
        const supplierB = call("mantle.party.PartyServices.create#Organization", { organizationName: "Request Supplier B", roleTypeId: "Supplier" }).partyId
        const purchaseRequest = call("mantle.request.RequestServices.create#Request", { requestName: "Buy stuff", requestTypeEnumId: "RqtPurchase", facilityId: warehouse }).requestId
        call("create#mantle.request.RequestItem", { requestId: purchaseRequest, requestItemSeqId: "01", productId: "DEMO_1_1", quantity: 3, supplierPartyId: supplierA })
        call("create#mantle.request.RequestItem", { requestId: purchaseRequest, requestItemSeqId: "02", productId: "DEMO_2_1", quantity: 2, supplierPartyId: supplierB })
        call("create#mantle.request.RequestItem", { requestId: purchaseRequest, requestItemSeqId: "03", productId: "DEMO_3_1", quantity: 1, supplierPartyId: supplierA })
        call("update#mantle.request.Request", { requestId: purchaseRequest, statusId: "ReqSubmitted" })
        const out = call("mantle.order.OrderServices.create#PurchaseRequestOrder", { requestId: purchaseRequest, customerPartyId: "ORG_ZIZI_RETAIL" })
        const links = Array.from(ec.entity.find("mantle.request.RequestItemOrder").condition("requestId", purchaseRequest).list())
        const orderIds = [...new Set(links.map(l => l.orderId))]
        const req = ec.entity.find("mantle.request.Request").condition("requestId", purchaseRequest).one()
        return { out, links, orderIds, req }
    },
    then({ links, orderIds, req }) {
        // one order for each supplier holds that supplier's items
        links.length == 3
        orderIds.length == 2
        req.statusId == "ReqInProgress"
    },
})

feature("comment on a wiki page", {
    when() {
        const pageId = call("create#moqui.resource.wiki.WikiPage", { wikiSpaceId: "ZZW_RETAIL", pagePath: "crm-misc-comment-page" }).wikiPageId
        call("mantle.party.CommunicationServices.add#WikiPageComment", { wikiPageId: pageId, subject: "Nice page", body: "Thanks" })
        const links = Array.from(ec.entity.find("mantle.party.communication.WikiPageCommunicationEvent").condition("wikiPageId", pageId).list())
        const event = ec.entity.find("mantle.party.communication.CommunicationEvent").condition("communicationEventId", links[0].communicationEventId).one()
        return { links, event }
    },
    then({ links, event }) {
        links.length == 1
        event.subject == "Nice page"
        event.communicationEventTypeId == "Comment"
        event.statusId == "CeSent"
    },
})
