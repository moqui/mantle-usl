// Content records of payments, agreements and parties (create, update and locate), without an uploaded file: the services
// that save a file take a FileItem, which a spec cannot make. New spec, no Groovy original.
const effectiveTime = Date.now()
let personId, paymentId, agreementId

spec({
    stepwise: true,
    tempSequences: { start: 59600, banks: { "mantle.party.Party": 10, "mantle.account.payment.Payment": 10, "mantle.party.agreement.Agreement": 10 } },
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

// an enumeration of the type, created when none is seeded
function enumOf(enumTypeId) {
    const found = Array.from(ec.entity.find("moqui.basic.Enumeration").condition("enumTypeId", enumTypeId).list())
    if (found.length) return found[0].enumId
    if (!ec.entity.find("moqui.basic.EnumerationType").condition("enumTypeId", enumTypeId).one()) call("create#moqui.basic.EnumerationType", { enumTypeId, description: enumTypeId })
    call("create#moqui.basic.Enumeration", { enumId: "ZZ" + enumTypeId, enumTypeId, description: enumTypeId })
    return "ZZ" + enumTypeId
}

feature("a payment's content records", {
    when() {
        personId = call("mantle.party.PartyServices.create#Person", { firstName: "Content", lastName: "Holder" }).partyId
        paymentId = call("mantle.account.PaymentServices.create#Payment", { fromPartyId: personId, toPartyId: "ORG_ZIZI_RETAIL", amount: 10, amountUomId: "USD", statusId: "PmntPromised" }).paymentId
        const type = enumOf("PaymentContentType")
        const contentId = call("mantle.account.PaymentServices.create#PaymentContent", { paymentId, contentTypeEnumId: type, description: "receipt" }).paymentContentId
        call("mantle.account.PaymentServices.update#PaymentContent", { paymentContentId: contentId, description: "receipt edited" })
        const content = ec.entity.find("mantle.account.payment.PaymentContent").condition("paymentContentId", contentId).one()
        const location = call("mantle.account.PaymentServices.get#PaymentContentLocation", { paymentId, contentTypeEnumIdList: [type] })
        const fileId = call("mantle.account.PaymentServices.create#PaymentContent", { paymentId, contentTypeEnumId: type, contentFile: uploadedFile("pay.txt", "proof") }).paymentContentId
        call("mantle.account.PaymentServices.update#PaymentContent", { paymentContentId: fileId, contentFile: uploadedFile("pay2.txt", "proof 2") })
        return { content, location, contentId }
    },
    then({ content, location, contentId }) {
        contentId != null
        content.description == "receipt edited"
        content.paymentId == paymentId
        // the entity's defaults: the effective time and the signed-in user
        String(content.contentDate) == String(effectiveTime)
        content.userId != null
        location.paymentContent.paymentContentId == contentId
    },
})

feature("an agreement's content records", {
    when() {
        agreementId = call("create#mantle.party.agreement.Agreement", { agreementTypeEnumId: enumOf("AgreementType"), fromPartyId: "ORG_ZIZI_RETAIL", toPartyId: personId,
                fromDate: effectiveTime - 86400000 }).agreementId
        const type = enumOf("AgreementContentType")
        const contentId = call("mantle.party.AgreementServices.create#AgreementContent", { agreementId, contentTypeEnumId: type, description: "terms" }).agreementContentId
        call("mantle.party.AgreementServices.update#AgreementContent", { agreementContentId: contentId, description: "terms edited" })
        const fileId = call("mantle.party.AgreementServices.create#AgreementContent", { agreementId, contentTypeEnumId: type, contentFile: uploadedFile("agr.txt", "signed") }).agreementContentId
        call("mantle.party.AgreementServices.update#AgreementContent", { agreementContentId: fileId, contentFile: uploadedFile("agr2.txt", "signed 2") })
        return { content: ec.entity.find("mantle.party.agreement.AgreementContent").condition("agreementContentId", contentId).one() }
    },
    then({ content }) {
        content.description == "terms edited"
        content.agreementId == agreementId
    },
})

feature("a party's content records", {
    when() {
        const type = enumOf("PartyContentType")
        const contentId = call("mantle.party.PartyServices.create#PartyContent", { partyId: personId, partyContentTypeEnumId: type, description: "photo" }).partyContentId
        call("mantle.party.PartyServices.update#PartyContent", { partyContentId: contentId, description: "photo edited" })
        const fileId = call("mantle.party.PartyServices.create#PartyContent", { partyId: personId, partyContentTypeEnumId: type, contentFile: uploadedFile("face.txt", "face") }).partyContentId
        call("mantle.party.PartyServices.update#PartyContent", { partyContentId: fileId, contentFile: uploadedFile("face2.txt", "face 2") })
        const content = ec.entity.find("mantle.party.PartyContent").condition("partyContentId", contentId).one()
        const location = call("mantle.party.PartyServices.get#PartyContentLocation", { partyId: personId, partyContentTypeEnumIdList: [type] })
        return { content, location }
    },
    then({ content, location }) {
        content.description == "photo edited"
        content.partyId == personId
        location != null
    },
})
