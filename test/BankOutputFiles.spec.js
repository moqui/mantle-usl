// Outgoing bank files: NACHA (mantle.account.NachaServices) and Positive Pay in each supported format
// (PositivePayServices). New spec, no Groovy original.
const organizationPartyId = "ORG_ZIZI_RETAIL"
const effectiveTime = Date.now()
let payeeId, companyBankId, payeeBankId, achPaymentIds = [], nachaOut

spec({
    stepwise: true,
    tempSequences: { start: 56500, banks: { "mantle.party.Party": 10, "mantle.account.payment.Payment": 40,
        "mantle.account.method.PaymentMethod": 20, "mantle.account.method.PaymentMethodFile": 10 } },
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    return null
}

feature("set up a company bank account with NACHA settings, a payee and ACH payments", {
    when() {
        payeeId = call("mantle.party.PartyServices.create#Person", { firstName: "Pat", lastName: "Payee" }).partyId
        companyBankId = call("mantle.account.PaymentMethodServices.create#BankAccount", { ownerPartyId: organizationPartyId,
                description: "Company ACH", bankName: "Test Bank", routingNumber: "021000021", accountNumber: "5550001234",
                typeEnumId: "BatChecking", currencyUomId: "USD", companyNameOnAccount: "Ziziwork Retail",
                nachaImmedDest: "021000021", nachaImmedOrig: "1234567890", nachaCompanyId: "1234567890",
                nachaEntryDescription: "PAYROLL" }).paymentMethodId
        payeeBankId = call("mantle.account.PaymentMethodServices.create#BankAccount", { ownerPartyId: payeeId, description: "Payee Checking",
                bankName: "Payee Bank", routingNumber: "011000015", accountNumber: "111222333", typeEnumId: "BatChecking",
                firstNameOnAccount: "Pat", lastNameOnAccount: "Payee" }).paymentMethodId
        for (const amount of ["100.25", "2000.00"]) {
            achPaymentIds.push(call("mantle.account.PaymentServices.create#Payment", { fromPartyId: organizationPartyId, toPartyId: payeeId,
                    amount, amountUomId: "USD", paymentMethodId: companyBankId, toPaymentMethodId: payeeBankId,
                    paymentInstrumentEnumId: "PiAch", statusId: "PmntAuthorized", effectiveDate: effectiveTime - 3600000 }).paymentId)
        }
        return { ids: [payeeId, companyBankId, payeeBankId, ...achPaymentIds] }
    },
    then({ ids }) {
        ids.every(id => id != null)
        achPaymentIds.length == 2
    },
})

feature("generate a NACHA file", {
    when() {
        nachaOut = call("mantle.account.NachaServices.generate#NachaFile", { paymentMethodId: companyBankId, addNewLine: true, addOffsetRecord: true,
                effectiveEntryDate: "2026-12-15" })
        const lines = nachaOut.fileText.split("\n").filter(l => l.length)
        const file = ec.entity.find("mantle.account.method.PaymentMethodFile").condition("paymentMethodFileId", nachaOut.paymentMethodFileId).one()
        const payments = achPaymentIds.map(id => ec.entity.find("mantle.account.payment.Payment").condition("paymentId", id).one())
        return { lines, file, payments }
    },
    then({ lines, file, payments }) {
        // file header, batch header, two credits, one offset debit, batch control, file control, then 9-filled lines to a
        // multiple of ten records
        lines.length == 10
        lines.every(l => l.length == 94)
        lines[0].startsWith("101")
        lines[1].startsWith("5200")
        lines[2].startsWith("622")
        lines[2].includes("011000015")
        lines[3].startsWith("622")
        lines[4].startsWith("627")
        lines[5].startsWith("8200")
        lines[6].startsWith("9")
        lines.slice(7).every(l => l == "9".repeat(94))
        lines[2].substring(29, 39) == "0000010025"
        lines[3].substring(29, 39) == "0000200000"
        file.fileTypeEnumId == "PmftNacha"
        payments.every(p => p.paymentMethodFileId == nachaOut.paymentMethodFileId)
    },
})

feature("a second NACHA run has nothing to send, and bad configuration is refused", {
    when() {
        const again = call("mantle.account.NachaServices.generate#NachaFile", { paymentMethodId: companyBankId })
        const missing = errorOf("mantle.account.NachaServices.generate#NachaFile", { paymentMethodId: "NO_SUCH_METHOD" })
        return { again, missing }
    },
    then({ again, missing }) {
        again.fileText == null
        missing.includes("is not a bank account")
    },
})

const formats = ["PmftBankOfAmericaAr", "PmftCityBankCnb", "PmftSunTrustCpr", "PmftWachoviaAr", "PmftWellsFargoArp", "PmftZionsBankCsv"]
feature("generate Positive Pay files #format", {
    where: formats.map(format => ({ format })),
    when(ctx) {
        const format = ctx.format
        const bankId = call("mantle.account.PaymentMethodServices.create#BankAccount", { ownerPartyId: organizationPartyId,
                description: "PosPay " + format, bankName: "Test Bank", routingNumber: "021000021", accountNumber: "7770001234",
                typeEnumId: "BatChecking", currencyUomId: "USD", posPayFormatEnumId: format, posPayBankNumber: "123" }).paymentMethodId
        for (const [index, amount] of ["150.00", "75.50"].entries()) {
            call("mantle.account.PaymentServices.create#Payment", { fromPartyId: organizationPartyId, toPartyId: payeeId, amount, amountUomId: "USD",
                    paymentMethodId: bankId, paymentRefNum: String(2001 + index), paymentInstrumentEnumId: "PiCompanyCheck",
                    statusId: "PmntDelivered", effectiveDate: effectiveTime - 3600000 })
        }
        const out = call("mantle.account.PositivePayServices.generate#PositivePayFile", { paymentMethodId: bankId })
        const payments = ec.entity.find("mantle.account.payment.Payment").condition("paymentMethodId", bankId).list()
        return { out, payments }
    },
    then({ out, payments }) {
        out.paymentCount == 2
        out.fileText.length > 0
        out.fileText.includes("2001")
        out.fileText.includes("2002")
        payments.every(p => p.paymentMethodFileId == out.paymentMethodFileId)
    },
})

feature("Positive Pay is refused without a format", {
    when() {
        const noFormat = errorOf("mantle.account.PositivePayServices.generate#PositivePayFile", { paymentMethodId: companyBankId })
        return { noFormat }
    },
    then({ noFormat }) {
        noFormat.includes("No Pos. Pay File Format")
    },
})

feature("import a NACHA return: a returned entry declines its payment and a bad line is an error", {
    when() {
        const pad = (text, n) => String(text).padEnd(n, " ").slice(0, n)
        const entry = (paymentId, amountCents) => "6" + "26" + "01100001" + "5" + pad("111222333", 17) + String(amountCents).padStart(10, "0") + pad(paymentId, 15) +
                pad("Pat Payee", 22) + "  " + "1" + "011000010000001"
        const returnAddenda = (reason, info) => "7" + "99" + reason + "011000010000001" + "      " + "01100001" + pad(info, 44) + "011000010000009"
        const text = [entry(achPaymentIds[0], 10025), returnAddenda("R01", "Insufficient funds"), "9" + " ".repeat(93)].join("\n")
        call("mantle.account.NachaServices.import#NachaReturn", { paymentMethodId: companyBankId, nachaString: text })
        const returned = ec.entity.find("mantle.account.payment.Payment").condition("paymentId", achPaymentIds[0]).one()
        const responses = Array.from(ec.entity.find("mantle.account.method.PaymentGatewayResponse").condition("paymentId", achPaymentIds[0]).list())
        // the service adds its errors to the message facade without stopping, so read them from there
        const errorsOf = (nachaString) => {
            ec.service.sync().name("mantle.account.NachaServices.import#NachaReturn").parameters({ paymentMethodId: companyBankId, nachaString }).call()
            const text = ec.message.getErrorsString()
            ec.message.clearErrors()
            return text
        }
        const short = errorsOf("6short")
        return { returned, responses, short }
    },
    then({ returned, responses, short }) {
        returned.statusId == "PmntDeclined"
        responses.length >= 1
        responses.some(r => r.reasonCode == "R01")
        short.includes("Length of the line is incorrect")
    },
})

feature("system messages carry the files: a return is consumed, a file is queued, and the positive pay job sends its file", {
    when() {
        call("create#moqui.service.message.SystemMessageType", { systemMessageTypeId: "TestAchReturn", description: "Test ACH return",
                consumeServiceName: "mantle.account.NachaServices.consume#NachaReturnSystemMessage" })
        call("create#moqui.service.message.SystemMessageType", { systemMessageTypeId: "TestBankOut", description: "Test outgoing bank file" })
        call("create#moqui.service.message.SystemMessageRemote", { systemMessageRemoteId: "TEST_BANK", description: "Test bank", systemMessageTypeId: "TestBankOut" })
        call("create#mantle.account.method.PaymentMethodFileType", { paymentMethodId: companyBankId, fileTypeEnumId: "PmftNacha",
                systemMessageTypeId: "TestAchReturn", systemMessageRemoteId: "TEST_BANK" })
        const pad = (text, n) => String(text).padEnd(n, " ").slice(0, n)
        const entry = "6" + "26" + "01100001" + "5" + pad("111222333", 17) + "0000200000" + pad(achPaymentIds[1], 15) + pad("Pat Payee", 22) + "  " + "1" + "011000010000002"
        const addenda = "7" + "99" + "R02" + "011000010000002" + "      " + "01100001" + pad("Account closed", 44) + "011000010000009"
        const messageId = call("create#moqui.service.message.SystemMessage", { systemMessageTypeId: "TestAchReturn", systemMessageRemoteId: "TEST_BANK", isOutgoing: "N",
                statusId: "SmsgReceived", messageText: [entry, addenda, "9" + " ".repeat(93)].join("\n"), initDate: effectiveTime }).systemMessageId
        call("mantle.account.NachaServices.consume#NachaReturnSystemMessage", { systemMessageId: messageId })
        const declined = ec.entity.find("mantle.account.payment.Payment").condition("paymentId", achPaymentIds[1]).one()
        // queue the NACHA file that was generated earlier as an outgoing message, once
        const notFound = call("mantle.account.PaymentMethodServices.produce#PaymentMethodFileSystemMessage", { paymentMethodFileId: "NO_SUCH_FILE" })
        const noConfig = call("mantle.account.PaymentMethodServices.produce#PaymentMethodFileSystemMessage", { paymentMethodFileId: nachaOut.paymentMethodFileId })
        const queued = call("mantle.account.PaymentMethodServices.produce#PaymentMethodFileSystemMessage", { paymentMethodFileId: nachaOut.paymentMethodFileId,
                systemMessageTypeId: "TestBankOut", systemMessageRemoteId: "TEST_BANK" })
        const again = call("mantle.account.PaymentMethodServices.produce#PaymentMethodFileSystemMessage", { paymentMethodFileId: nachaOut.paymentMethodFileId,
                systemMessageTypeId: "TestBankOut", systemMessageRemoteId: "TEST_BANK" })
        const message = ec.entity.find("moqui.service.message.SystemMessage").condition("systemMessageId", queued.systemMessageId).one()
        return { declined, notFound, noConfig, queued, again, message }
    },
    then({ declined, queued, again, message }) {
        declined.statusId == "PmntDeclined"
        queued.systemMessageId != null
        again.systemMessageId == null
        message.isOutgoing == "Y"
        message.paymentMethodFileId == nachaOut.paymentMethodFileId
    },
})

feature("the positive pay job generates the file and queues it, and does nothing when there are no checks", {
    when() {
        const bankId = call("mantle.account.PaymentMethodServices.create#BankAccount", { ownerPartyId: organizationPartyId, description: "PosPay Job",
                bankName: "Test Bank", routingNumber: "021000021", accountNumber: "8880001234", typeEnumId: "BatChecking", currencyUomId: "USD",
                posPayFormatEnumId: "PmftWachoviaAr", posPayBankNumber: "123" }).paymentMethodId
        call("create#mantle.account.method.PaymentMethodFileType", { paymentMethodId: bankId, fileTypeEnumId: "PmftWachoviaAr",
                systemMessageTypeId: "TestBankOut", systemMessageRemoteId: "TEST_BANK" })
        const empty = call("mantle.account.PositivePayServices.send#PositivePayJob", { paymentMethodId: bankId })
        call("mantle.account.PaymentServices.create#Payment", { fromPartyId: organizationPartyId, toPartyId: payeeId, amount: "99.00", amountUomId: "USD",
                paymentMethodId: bankId, paymentRefNum: "3001", paymentInstrumentEnumId: "PiCompanyCheck", statusId: "PmntDelivered", effectiveDate: effectiveTime - 3600000 })
        const sent = call("mantle.account.PositivePayServices.send#PositivePayJob", { paymentMethodId: bankId, lookBackDays: 5 })
        return { empty, sent }
    },
    then({ empty, sent }) {
        empty.paymentMethodFileId == null
        sent.paymentMethodFileId != null
        sent.systemMessageId != null
    },
})
