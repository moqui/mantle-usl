// Payroll processing (mantle.humanres.PayrollServices): a salaried and an hourly employee, a closed PayrollMonth, the
// payroll invoices, the payments for them, and re-opening a period. New spec, no Groovy original.
const organizationPartyId = "ORG_ZIZI_RETAIL"
const effectiveTime = Date.now()
const day = (y, m, d) => Date.UTC(y, m - 1, d)
let salaryEmployeeId, hourlyEmployeeId, salaryRelId, hourlyRelId, timePeriodId, febPeriodId
let processOut, invoiceIdByRel

spec({
    stepwise: true,
    tempSequences: { start: 56100, banks: { "mantle.party.Party": 10, "mantle.humanres.position.EmplPosition": 10,
        "mantle.account.invoice.Invoice": 10, "mantle.account.payment.Payment": 10, "mantle.work.time.TimeEntry": 10 } },
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
function periodFor(basisDate, type) {
    call("mantle.humanres.EmploymentServices.check#NextPayrollTimePeriods", { organizationPartyId, basisDate })
    const list = ec.entity.find("mantle.party.time.TimePeriod").condition("partyId", organizationPartyId)
            .condition("timePeriodTypeId", type).condition("fromDate", "less-equals", basisDate)
            .condition("thruDate", "greater-equals", basisDate).list()
    return list[0].timePeriodId
}
function employ(firstName, lastName, positionId) {
    const partyId = call("mantle.party.PartyServices.create#Person", { firstName, lastName, roleTypeId: "Employee" }).partyId
    call("create#mantle.humanres.employment.Employee", { partyId, taxFederalAllowances: 1 })
    const partyRelationshipId = call("mantle.humanres.EmploymentServices.create#Employment",
            { fromPartyId: partyId, toPartyId: organizationPartyId, fromDate: day(2026, 1, 1), emplPositionId: positionId,
                timePeriodTypeId: "PayrollMonth" }).partyRelationshipId
    return { partyId, partyRelationshipId }
}

feature("set up employees, positions, salary and time", {
    when() {
        const salaryPos = call("create#mantle.humanres.position.EmplPosition", { organizationPartyId, emplPositionClassId: "Programmer",
                description: "Salaried Programmer", salaryFlag: "Y", fromDate: day(2025, 1, 1) }).emplPositionId
        const hourlyPos = call("create#mantle.humanres.position.EmplPosition", { organizationPartyId, emplPositionClassId: "Programmer",
                description: "Hourly Programmer", salaryFlag: "N", fromDate: day(2025, 1, 1) }).emplPositionId
        const salaried = employ("Sally", "Salaried", salaryPos)
        const hourly = employ("Hank", "Hourly", hourlyPos)
        salaryEmployeeId = salaried.partyId; salaryRelId = salaried.partyRelationshipId
        hourlyEmployeeId = hourly.partyId; hourlyRelId = hourly.partyRelationshipId
        call("mantle.humanres.EmploymentServices.create#EmploymentSalary",
                { partyRelationshipId: salaryRelId, amount: 5000, currencyUomId: "USD", fromDate: day(2026, 1, 1) })
        // hourly: a rate and two days of time
        const rateAmountId = call("mantle.humanres.RateServices.create#RateAmount",
                { rateTypeEnumId: "RatpStandard", ratePurposeEnumId: "RaprVendor", partyId: hourlyEmployeeId,
                    rateAmount: 25, rateCurrencyUomId: "USD", fromDate: day(2026, 1, 1) }).rateAmountId
        for (const d of [10, 11]) {
            call("create#mantle.work.time.TimeEntry", { partyId: hourlyEmployeeId, clientPartyId: organizationPartyId,
                    fromDate: day(2026, 3, d) + 9 * 3600000, thruDate: day(2026, 3, d) + 17 * 3600000, hours: 8,
                    vendorRateAmountId: rateAmountId, rateTypeEnumId: "RatpStandard" })
        }
        timePeriodId = periodFor("2026-03-15", "PayrollMonth")
        febPeriodId = periodFor("2026-02-15", "PayrollMonth")
        return { salaryPos, hourlyPos }
    },
    then({ salaryPos, hourlyPos }) {
        salaryPos != null
        hourlyPos != null
        timePeriodId != null
        febPeriodId != null
        timePeriodId != febPeriodId
    },
})

feature("get TimePeriodEmployments", {
    when() { return { out: call("mantle.humanres.PayrollServices.get#TimePeriodEmployments", { timePeriodId }) } },
    then({ out }) {
        out.employmentList.map(e => e.partyRelationshipId).includes(salaryRelId)
        out.employmentList.map(e => e.partyRelationshipId).includes(hourlyRelId)
        out.timePeriod.timePeriodId == timePeriodId
    },
})

feature("get EmploymentPayAmount for salary and hourly employees", {
    when() {
        const salary = call("mantle.humanres.PayrollServices.get#EmploymentPayAmount", { partyRelationshipId: salaryRelId, timePeriodId })
        const hourly = call("mantle.humanres.PayrollServices.get#EmploymentPayAmount", { partyRelationshipId: hourlyRelId, timePeriodId })
        return { salary, hourly }
    },
    then({ salary, hourly }) {
        salary.payAmount == 5000
        salary.salaryFlag == "Y"
        salary.currencyUomId == "USD"
        hourly.payAmount == 400
        hourly.salaryFlag == "N"
        hourly.timeEntryList.length == 2
    },
})

feature("get TimePeriodTotalPayAmount", {
    when() { return { out: call("mantle.humanres.PayrollServices.get#TimePeriodTotalPayAmount", { timePeriodId }) } },
    then({ out }) { out.payAmountByCurrencyUomId.USD == 5400 },
})

feature("process TimePeriodPay closes the period and makes an invoice per employee", {
    when() {
        processOut = call("mantle.humanres.PayrollServices.process#TimePeriodPay", { timePeriodId })
        invoiceIdByRel = processOut.invoiceIdByPartyRelationshipId
        const period = ec.entity.find("mantle.party.time.TimePeriod").condition("timePeriodId", timePeriodId).one()
        const history = ec.entity.find("mantle.humanres.employment.EmploymentPayHistory").condition("timePeriodId", timePeriodId).list()
        const salaryInvoice = ec.entity.find("mantle.account.invoice.Invoice").condition("invoiceId", invoiceIdByRel[salaryRelId]).one()
        return { period, history, salaryInvoice }
    },
    then({ period, history, salaryInvoice }) {
        period.isClosed == "Y"
        history.length == 2
        processOut.totalPayAmount == 5400
        processOut.totalNetPayAmount <= processOut.totalPayAmount
        salaryInvoice.invoiceTypeEnumId == "InvoicePayroll"
        salaryInvoice.statusId == "InvoiceReceived"
        salaryInvoice.fromPartyId == salaryEmployeeId
        salaryInvoice.toPartyId == organizationPartyId
    },
})

feature("process TimePeriodPay on a closed period reports an error", {
    when() { return { error: errorOf("mantle.humanres.PayrollServices.process#TimePeriodPay", { timePeriodId }) } },
    then({ error }) { error.includes("already closed") },
})

feature("approve PeriodInvoices and create PeriodPayments", {
    when() {
        call("mantle.humanres.PayrollServices.approve#PeriodInvoices", { timePeriodId })
        const approved = ec.entity.find("mantle.account.invoice.Invoice").condition("timePeriodId", timePeriodId)
                .condition("invoiceTypeEnumId", "InvoicePayroll").condition("statusId", "InvoiceApproved").list()
        call("mantle.humanres.PayrollServices.create#PeriodPayments", { timePeriodId, effectiveDate: effectiveTime })
        const payments = ec.entity.find("mantle.account.payment.Payment").condition("timePeriodId", timePeriodId).list()
        return { approved, payments }
    },
    then({ approved, payments }) {
        approved.length == 2
        payments.length == 2
    },
})

feature("set PeriodPaymentDates, PeriodPaymentRefNums and deliver PeriodPayments", {
    when() {
        call("mantle.humanres.PayrollServices.set#PeriodPaymentDates", { timePeriodId, effectiveDate: effectiveTime + 86400000, overrideDates: true })
        const dated = ec.entity.find("mantle.account.payment.Payment").condition("timePeriodId", timePeriodId).list()
        call("mantle.humanres.PayrollServices.set#PeriodPaymentRefNums", { timePeriodId })
        call("mantle.humanres.PayrollServices.authorize#PeriodPayments", { timePeriodId })
        call("mantle.humanres.PayrollServices.deliver#PeriodPayments", { timePeriodId })
        const delivered = ec.entity.find("mantle.account.payment.Payment").condition("timePeriodId", timePeriodId).list()
        return { dated, delivered }
    },
    then({ dated, delivered }) {
        dated.length == 2
        String(dated[0].effectiveDate)  == String(effectiveTime + 86400000)
        delivered.every(p => p.statusId == "PmntDelivered")
    },
})

feature("reopen PayrollPeriod is refused once invoices are approved", {
    when() { return { error: errorOf("mantle.humanres.PayrollServices.reopen#PayrollPeriod", { timePeriodId }) } },
    then({ error }) { error.includes("cannot re-open period") },
})

feature("process then reopen a PayrollPeriod", {
    when() {
        const out = call("mantle.humanres.PayrollServices.process#TimePeriodPay", { timePeriodId: febPeriodId })
        const closed = ec.entity.find("mantle.party.time.TimePeriod").condition("timePeriodId", febPeriodId).one().isClosed
        const invoices = ec.entity.find("mantle.account.invoice.Invoice").condition("timePeriodId", febPeriodId).list().length
        call("mantle.humanres.PayrollServices.reopen#PayrollPeriod", { timePeriodId: febPeriodId })
        const reopened = ec.entity.find("mantle.party.time.TimePeriod").condition("timePeriodId", febPeriodId).one().isClosed
        const invoicesAfter = ec.entity.find("mantle.account.invoice.Invoice").condition("timePeriodId", febPeriodId).list().length
        const history = ec.entity.find("mantle.humanres.employment.EmploymentPayHistory").condition("timePeriodId", febPeriodId).list().length
        return { out, closed, invoices, reopened, invoicesAfter, history }
    },
    then({ out, closed, invoices, reopened, invoicesAfter, history }) {
        closed == "Y"
        invoices >= 1
        reopened == "N"
        invoicesAfter == 0
        history == 0
    },
})
