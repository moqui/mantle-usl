// Payment methods (mantle.account.PaymentMethodServices): credit cards and bank accounts, storing and updating (an
// update clones the immutable record), deleting and expunging, payment method files and content. New spec, no Groovy
// original.
const effectiveTime = Date.now()
const year = new Date(effectiveTime).getUTCFullYear()
let ownerId, cardId, card2Id, bankId, fileId

spec({
    stepwise: true,
    tempSequences: { start: 57500, banks: { "mantle.party.Party": 10, "mantle.account.method.PaymentMethod": 30,
        "mantle.account.method.PaymentMethodFile": 10, "mantle.account.payment.Payment": 10, "mantle.party.contact.ContactMech": 20 } },
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
const pm = (id) => ec.entity.find("mantle.account.method.PaymentMethod").condition("paymentMethodId", id).one()

feature("store a credit card with a billing address, and get the party's payment method info", {
    when() {
        ownerId = call("mantle.party.PartyServices.create#Person", { firstName: "Cardy", lastName: "Holder" }).partyId
        const stored = call("mantle.account.PaymentMethodServices.store#PaymentMethodInfo", { partyId: ownerId, paymentMethodTypeEnumId: "PmtCreditCard",
                creditCardTypeEnumId: "CctVisa", cardNumber: "4111111111111111", expireMonth: "12", expireYear: String(year + 2), firstNameOnAccount: "Cardy", lastNameOnAccount: "Holder",
                address1: "1 Card St", city: "Orem", stateProvinceGeoId: "USA_UT", postalCode: "84057", countryGeoId: "USA" })
        cardId = stored.paymentMethodId
        const info = call("mantle.account.PaymentMethodServices.get#PartyPaymentMethodInfo", { partyId: ownerId, paymentMethodId: cardId })
        const list = call("mantle.account.PaymentMethodServices.get#PartyPaymentMethodInfoList", { partyId: ownerId })
        return { stored, info, list }
    },
    then({ stored, info, list }) {
        cardId != null
        stored.postalContactMechId != null
        info.paymentMethod.paymentMethodId == cardId
        info.creditCard != null
        info.maskedCardNumber.endsWith("1111")
        info.expireMonth == "12"
        list.methodInfoList.length == 1
    },
})

feature("updating a credit card keeps the record immutable by cloning it", {
    when() {
        const out = call("mantle.account.PaymentMethodServices.store#PaymentMethodInfo", { partyId: ownerId, paymentMethodId: cardId, paymentMethodTypeEnumId: "PmtCreditCard",
                expireMonth: "11", expireYear: String(year + 3), firstNameOnAccount: "Cardy", lastNameOnAccount: "Holder" })
        card2Id = out.paymentMethodId
        const old = pm(cardId)
        const list = call("mantle.account.PaymentMethodServices.get#PartyPaymentMethodInfoList", { partyId: ownerId })
        return { out, old, list }
    },
    then({ out, old, list }) {
        card2Id != null
        card2Id != cardId
        old.thruDate != null
        list.methodInfoList.length == 1
    },
})

feature("mutable fields update in place; create and update a bank account", {
    when() {
        call("mantle.account.PaymentMethodServices.update#PaymentMethodMutable", { paymentMethodId: card2Id, description: "Personal card", trustLevelEnumId: "CmtlVerified" })
        const mutable = pm(card2Id)
        bankId = call("mantle.account.PaymentMethodServices.create#BankAccount", { ownerPartyId: ownerId, bankName: "Card Bank", routingNumber: "021000021", accountNumber: "444555666",
                typeEnumId: "BatChecking", firstNameOnAccount: "Cardy", lastNameOnAccount: "Holder" }).paymentMethodId
        const updated = call("mantle.account.PaymentMethodServices.update#BankAccount", { paymentMethodId: bankId, bankName: "Card Bank 2" })
        call("mantle.account.PaymentMethodServices.update#BankAccountMutable", { paymentMethodId: updated.paymentMethodId, lastCheckNumber: 1000, nachaCompanyName: "CARDY", posPayBankNumber: "123" })
        const bank = ec.entity.find("mantle.account.method.BankAccount").condition("paymentMethodId", updated.paymentMethodId).one()
        // an update of the immutable bank account fields makes a new record, which is the one in use from now on
        bankId = updated.paymentMethodId
        return { mutable, updated, bank }
    },
    then({ mutable, updated, bank }) {
        mutable.description == "Personal card"
        updated.paymentMethodId != null
        n(bank.lastCheckNumber) == 1000
        bank.nachaCompanyName == "CARDY"
    },
})

feature("payment method content text", {
    when() {
        const contentId = call("mantle.account.PaymentMethodServices.create#PaymentMethodContent", { paymentMethodId: card2Id, contentTypeEnumId: "PmctImage", description: "scan" }).paymentMethodContentId
        call("mantle.account.PaymentMethodServices.update#PaymentMethodContent", { paymentMethodContentId: contentId, description: "scan edited" })
        const pmFileId = call("mantle.account.PaymentMethodServices.create#PaymentMethodContent", { paymentMethodId: card2Id, contentTypeEnumId: "PmctImage", contentFile: uploadedFile("card.txt", "front") }).paymentMethodContentId
        call("mantle.account.PaymentMethodServices.update#PaymentMethodContent", { paymentMethodContentId: pmFileId, contentFile: uploadedFile("card2.txt", "back") })
        const loc = call("mantle.account.PaymentMethodServices.get#PaymentMethodContentLocation", { paymentMethodId: card2Id, contentTypeEnumIdList: ["PmctImage"] })
        return { contentId, loc }
    },
    then({ contentId }) { contentId != null },
})

feature("delete expires a payment method, and checkDelete expires one marked as set automatically", {
    when() {
        call("mantle.account.PaymentMethodServices.delete#PaymentMethod", { paymentMethodId: card2Id })
        const deleted = pm(card2Id)
        const autoId = call("mantle.account.PaymentMethodServices.create#BankAccount", { ownerPartyId: ownerId, bankName: "Temp Bank", routingNumber: "011000015", accountNumber: "1", thruDateSetAuto: "Y" }).paymentMethodId
        const payId = call("mantle.account.PaymentServices.create#Payment", { fromPartyId: ownerId, toPartyId: "ORG_ZIZI_RETAIL", amount: 5, amountUomId: "USD", paymentMethodId: autoId, statusId: "PmntDelivered", effectiveDate: effectiveTime }).paymentId
        call("mantle.account.PaymentMethodServices.checkDelete#PaymentPaymentMethods", { paymentId: payId })
        return { deleted, auto: pm(autoId) }
    },
    then({ deleted, auto }) {
        deleted.thruDate != null
        auto.thruDate != null
    },
})

feature("payment method files: complete and cancel", {
    when() {
        const payId = call("mantle.account.PaymentServices.create#Payment", { fromPartyId: "ORG_ZIZI_RETAIL", toPartyId: ownerId, amount: 12, amountUomId: "USD", paymentMethodId: bankId, statusId: "PmntAuthorized",
                paymentInstrumentEnumId: "PiAch", effectiveDate: effectiveTime }).paymentId
        fileId = call("create#mantle.account.method.PaymentMethodFile", { paymentMethodId: bankId, fileTypeEnumId: "PmftNacha", fileDate: effectiveTime }).paymentMethodFileId
        call("update#mantle.account.payment.Payment", { paymentId: payId, paymentMethodFileId: fileId })
        call("mantle.account.PaymentMethodServices.update#PaymentMethodFileComplete", { paymentMethodFileId: fileId, fileText: "FILE", paymentList: [{ paymentId: payId }] })
        const completed = ec.entity.find("mantle.account.method.PaymentMethodFile").condition("paymentMethodFileId", fileId).one()
        const delivered = ec.entity.find("mantle.account.payment.Payment").condition("paymentId", payId).one()
        call("mantle.account.PaymentMethodServices.cancel#PaymentMethodFile", { paymentMethodFileId: fileId })
        const afterCancel = ec.entity.find("mantle.account.payment.Payment").condition("paymentId", payId).one()
        return { completed, delivered, afterCancel }
    },
    then({ completed, delivered, afterCancel }) {
        completed.fileText == "FILE"
        delivered.statusId == "PmntDelivered"
        afterCancel.paymentMethodFileId == null
    },
})

feature("expunge removes a payment method and its clones", {
    when() {
        // expunge leaves clearing records that refer to the payment method as a TODO, so remove the content made above
        ec.entity.find("mantle.account.method.PaymentMethodContent").condition("paymentMethodId", card2Id).deleteAll()
        call("mantle.account.PaymentMethodServices.expunge#PaymentMethod", { paymentMethodId: card2Id })
        return { first: pm(cardId), second: pm(card2Id) }
    },
    then({ first, second }) {
        first == null
        second == null
    },
})
