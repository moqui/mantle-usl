// Bank statement import (OFX 1 and BAI 2) and payment reconciliation (mantle.account.OfxServices, BaiServices,
// ReconciliationServices). New spec, no Groovy original.
const organizationPartyId = "ORG_ZIZI_RETAIL"
const effectiveTime = Date.now()
const routing = "123456789", account = "9876543210"
let bankId, vendorId, paymentId, checkPaymentId

spec({
    stepwise: true,
    tempSequences: { start: 56400, banks: { "mantle.party.Party": 10, "mantle.account.payment.Payment": 10,
        "mantle.account.method.PaymentMethod": 10 } },
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
function trans(fitId) {
    return ec.entity.find("mantle.account.method.PaymentMethodTrans").condition("paymentMethodId", bankId).condition("fitId", fitId).one()
}

const ofx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260314120000<LANGUAGE>ENG</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS><CURDEF>USD
<BANKACCTFROM><BANKID>${routing}<ACCTID>${account}<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260301<DTEND>20260314
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260310120000<TRNAMT>-250.00<FITID>OFX1<CHECKNUM>1001<NAME>Vendor Check<MEMO>Invoice 77</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260312<TRNAMT>1500,50<FITID>OFX2<NAME>Customer Deposit</STMTTRN>
<STMTTRN><TRNTYPE>SRVCHG<DTPOSTED>20260313<TRNAMT>-12.00<FITID>OFX3<NAME>Monthly fee</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>10000.25<DTASOF>20260314120000</LEDGERBAL>
<AVAILBAL><BALAMT>9500.25<DTASOF>20260314120000</AVAILBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`

feature("create a vendor, a bank account and payments to reconcile", {
    when() {
        vendorId = call("mantle.party.PartyServices.create#Organization", { organizationName: "Bank Test Vendor", roleTypeId: "Supplier" }).partyId
        bankId = call("mantle.account.PaymentMethodServices.create#BankAccount", { ownerPartyId: organizationPartyId, description: "Test Checking",
                bankName: "Test Bank", routingNumber: routing, accountNumber: account, typeEnumId: "BatChecking", currencyUomId: "USD" }).paymentMethodId
        checkPaymentId = call("mantle.account.PaymentServices.create#Payment", { fromPartyId: organizationPartyId, toPartyId: vendorId,
                amount: 250, amountUomId: "USD", paymentMethodId: bankId, paymentRefNum: "1001", effectiveDate: Date.UTC(2026, 2, 9),
                paymentInstrumentEnumId: "PiCompanyCheck", statusId: "PmntDelivered" }).paymentId
        paymentId = call("mantle.account.PaymentServices.create#Payment", { fromPartyId: vendorId, toPartyId: organizationPartyId,
                amount: "1500.50", amountUomId: "USD", toPaymentMethodId: bankId, effectiveDate: Date.UTC(2026, 2, 11),
                paymentInstrumentEnumId: "PiCompanyCheck", statusId: "PmntDelivered" }).paymentId
        return { ids: [vendorId, bankId, checkPaymentId, paymentId] }
    },
    then({ ids }) { ids.every(id => id != null) },
})

feature("import an OFX file", {
    when() {
        call("mantle.account.OfxServices.import#OfxVersion1", { paymentMethodId: bankId, ofxString: ofx })
        // a second import adds nothing
        call("mantle.account.OfxServices.import#OfxVersion1", { paymentMethodId: bankId, ofxString: ofx })
        const list = ec.entity.find("mantle.account.method.PaymentMethodTrans").condition("paymentMethodId", bankId).list()
        const method = ec.entity.find("mantle.account.method.PaymentMethod").condition("paymentMethodId", bankId).one()
        return { list, method, first: trans("OFX1"), second: trans("OFX2") }
    },
    then({ list, method, first, second }) {
        list.length == 3
        first.transAmount == -250
        first.checkNumber == "1001"
        first.transName == "Vendor Check"
        first.transMemo == "Invoice 77"
        first.postedDate == String(Date.UTC(2026, 2, 10, 12, 0, 0))
        second.transAmount == 1500.5
        method.ledgerBalance == 10000.25
        method.availableBalance == 9500.25
    },
})

feature("an OFX file for another account is refused", {
    when() {
        const wrong = ofx.replace(routing, "999999999")
        return { error: errorOf("mantle.account.OfxServices.import#OfxVersion1", { paymentMethodId: bankId, ofxString: wrong }) }
    },
    then({ error }) {
        error != null
        error.includes("does not match routing number")
    },
})

feature("match#PaymentMethodTransUnmatched reconciles by check number and by amount", {
    when() {
        call("mantle.account.ReconciliationServices.match#PaymentMethodTransUnmatched", { paymentMethodId: bankId, lookBackDays: 10 })
        const check = ec.entity.find("mantle.account.payment.Payment").condition("paymentId", checkPaymentId).one()
        const deposit = ec.entity.find("mantle.account.payment.Payment").condition("paymentId", paymentId).one()
        return { check, deposit, first: trans("OFX1"), second: trans("OFX2"), fee: trans("OFX3") }
    },
    then({ check, deposit, first, second, fee }) {
        first.paymentId == checkPaymentId
        check.reconcileStatusId == "PmtrRec"
        second.paymentId == paymentId
        deposit.reconcileStatusId == "PmtrRec"
        fee.paymentId == null
    },
})

feature("unreconcile, noReconcile and reconcile by hand", {
    when() {
        call("mantle.account.ReconciliationServices.unreconcile#PaymentMethodTrans", { paymentMethodId: bankId, fitId: "OFX1" })
        const un = trans("OFX1")
        const unPayment = ec.entity.find("mantle.account.payment.Payment").condition("paymentId", checkPaymentId).one()
        call("mantle.account.ReconciliationServices.reconcile#PaymentMethodTrans", { paymentMethodId: bankId, fitId: "OFX1", paymentId: checkPaymentId })
        const again = trans("OFX1")
        call("mantle.account.ReconciliationServices.noReconcile#PaymentMethodTrans", { paymentMethodId: bankId, fitId: "OFX3" })
        const fee = trans("OFX3")
        // clear#PaymentTrans, as the SECA for a cancelled payment calls it
        call("mantle.account.ReconciliationServices.clear#PaymentTrans", { paymentId })
        const cleared = trans("OFX2")
        return { un, unPayment, again, fee, cleared }
    },
    then({ un, unPayment, again, fee, cleared }) {
        un.paymentId == null
        unPayment.reconcileStatusId == "PmtrNot"
        again.paymentId == checkPaymentId
        fee.noReconcile == "Y"
        cleared.paymentId == null
    },
})

feature("create and update PaymentMethodTrans by hand, and create#TransPayment", {
    when() {
        call("mantle.account.ReconciliationServices.create#PaymentMethodTrans", { paymentMethodId: bankId, fitId: "MAN1", transType: "PMTT_CREDIT",
                transCode: "108", postedDate: Date.UTC(2026, 2, 14), transAmount: 75, transName: "Manual" })
        call("mantle.account.ReconciliationServices.update#PaymentMethodTrans", { paymentMethodId: bankId, fitId: "MAN1", transMemo: "edited" })
        const manual = trans("MAN1")
        const out = call("mantle.account.ReconciliationServices.create#TransPayment", { paymentMethodId: bankId, fitId: "MAN1",
                fromPartyId: vendorId, toPartyId: organizationPartyId, amount: 75, amountUomId: "USD", toPaymentMethodId: bankId,
                effectiveDate: Date.UTC(2026, 2, 14), paymentInstrumentEnumId: "PiCompanyCheck", statusId: "PmntDelivered" })
        return { manual, out, linked: trans("MAN1") }
    },
    then({ manual, out, linked }) {
        manual.transMemo == "edited"
        manual.transAmount == 75
        out.paymentId != null
        linked.paymentId == out.paymentId
    },
})

feature("import a BAI 2 file", {
    when() {
        // 02 originator = routing; 03 account with ledger (015) and available (045) balances; two details; 49 control total is the
        // sum of the absolute detail amounts and the balances: 50.00 + 20.00 + 1000.00 + 1000.00
        const bai = [
            "01,SENDER,RECEIVER,260314,1200,1,80,,2/",
            `02,${routing},ORIG,1,260314,2359,USD,2/`,
            `03,${account},USD,015,100000,,,045,100000,,/`,
            "16,108,5000,S,2500,2500,Deposit memo,REF1",
            "16,475,2000,0,REF2,1001,Check memo",
            "49,207000,5/",
            "98,207000,1,7/",
            "99,207000,1,9/",
        ].join("\n")
        call("mantle.account.BaiServices.import#BaiVersion2", { paymentMethodId: bankId, baiString: bai })
        const list = Array.from(ec.entity.find("mantle.account.method.PaymentMethodTrans").condition("paymentMethodId", bankId).list())
                .filter(t => t.fitId != null && t.refNumber != null && (t.transCode == "108" || t.transCode == "475") && t.transName == null)
        const method = ec.entity.find("mantle.account.method.PaymentMethod").condition("paymentMethodId", bankId).one()
        const mismatch = errorOf("mantle.account.BaiServices.import#BaiVersion2", { paymentMethodId: bankId,
                baiString: bai.replace("49,207000", "49,999900") })
        return { list, method, mismatch }
    },
    then({ list, method, mismatch }) {
        list.length == 2
        list.find(t => t.transCode == "108").transAmount == 50
        list.find(t => t.transCode == "108").refNumber == "REF1"
        list.find(t => t.transCode == "475").transAmount == -20
        list.find(t => t.transCode == "475").checkNumber == "1001"
        method.ledgerBalance == 1000
        mismatch.includes("Control sum")
    },
})

feature("statements arrive as system messages and are consumed through the payment method's file types", {
    when() {
        call("create#moqui.service.message.SystemMessageType", { systemMessageTypeId: "TestBankIn", description: "Test incoming bank file" })
        call("create#moqui.service.message.SystemMessageRemote", { systemMessageRemoteId: "TEST_BANK_IN", description: "Test bank", systemMessageTypeId: "TestBankIn" })
        call("create#mantle.account.method.PaymentMethodFileType", { paymentMethodId: bankId, fileTypeEnumId: "PmftOfx", systemMessageTypeId: "TestBankIn", systemMessageRemoteId: "TEST_BANK_IN" })
        const message = (text, offset) => call("create#moqui.service.message.SystemMessage", { systemMessageTypeId: "TestBankIn", systemMessageRemoteId: "TEST_BANK_IN",
                isOutgoing: "N", statusId: "SmsgReceived", messageText: text, initDate: effectiveTime + offset }).systemMessageId
        const before = ec.entity.find("mantle.account.method.PaymentMethodTrans").condition("paymentMethodId", bankId).count()
        const newOfx = ofx.replace("OFX1", "OFXMSG1").replace("OFX2", "OFXMSG2").replace("OFX3", "OFXMSG3")
        call("mantle.account.OfxServices.consume#OfxV1SystemMessage", { systemMessageId: message(newOfx, 10) })
        const afterOfx = ec.entity.find("mantle.account.method.PaymentMethodTrans").condition("paymentMethodId", bankId).count()
        // the BAI file type is not configured for this message type yet
        const bai = ["01,SENDER,RECEIVER,260314,1200,1,80,,2/", `02,${routing},ORIG,1,260314,2359,USD,2/`, `03,${account},USD,015,100000,,,045,100000,,/`,
                "16,108,5000,S,2500,2500,Deposit memo,MSG-REF", "49,205000,4/", "98,205000,1,6/", "99,205000,1,8/"].join("\n")
        const notConfigured = errorOf("mantle.account.BaiServices.consume#Bai2SystemMessage", { systemMessageId: message(bai, 20) })
        call("create#mantle.account.method.PaymentMethodFileType", { paymentMethodId: bankId, fileTypeEnumId: "PmftBai2", systemMessageTypeId: "TestBankIn", systemMessageRemoteId: "TEST_BANK_IN" })
        call("mantle.account.BaiServices.consume#Bai2SystemMessage", { systemMessageId: message(bai, 30) })
        const afterBai = ec.entity.find("mantle.account.method.PaymentMethodTrans").condition("paymentMethodId", bankId).count()
        return { before, afterOfx, notConfigured, afterBai }
    },
    then({ before, afterOfx, notConfigured, afterBai }) {
        afterOfx == before + 3
        notConfigured.includes("Could not find paymentMethodId")
        afterBai == afterOfx + 1
    },
})

feature("statement files are uploaded: OFX and BAI 2 files", {
    when() {
        const before = ec.entity.find("mantle.account.method.PaymentMethodTrans").condition("paymentMethodId", bankId).count()
        call("mantle.account.OfxServices.upload#OfxVersion1", { paymentMethodId: bankId, ofxFile: uploadedFile("stmt.ofx", ofx.replace("OFX1", "OFXUP1").replace("OFX2", "OFXUP2").replace("OFX3", "OFXUP3")) })
        const afterOfx = ec.entity.find("mantle.account.method.PaymentMethodTrans").condition("paymentMethodId", bankId).count()
        const bai = ["01,SENDER,RECEIVER,260314,1200,1,80,,2/", `02,${routing},ORIG,1,260314,2359,USD,2/`, `03,${account},USD,015,100000,,,045,100000,,/`,
                "16,108,5000,S,2500,2500,Deposit memo,UP-REF", "49,205000,4/", "98,205000,1,6/", "99,205000,1,8/"].join("\n")
        call("mantle.account.BaiServices.upload#BaiVersion2", { paymentMethodId: bankId, baiFile: uploadedFile("stmt.bai", bai) })
        const afterBai = ec.entity.find("mantle.account.method.PaymentMethodTrans").condition("paymentMethodId", bankId).count()
        return { before, afterOfx, afterBai }
    },
    then({ before, afterOfx, afterBai }) {
        afterOfx == before + 3
        afterBai == afterOfx + 1
    },
})
