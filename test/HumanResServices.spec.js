// Employment, salary and rate services (mantle.humanres.*): none of the ported flows reach them. New spec, no Groovy original.
const organizationPartyId = "ORG_ZIZI_RETAIL"
const effectiveTime = Date.now()
let employeeId, partyRelationshipId, secondEmployeeId, rateAmountId

spec({
    tempSequences: { start: 56000, banks: { "mantle.party.Party": 10, "mantle.humanres.rate.RateAmount": 10 } },
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

// the message of a call that is expected to fail, with the errors cleared so the feature does not fail on them
function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    return null
}

feature("create Employee and Employment", {
    when() {
        employeeId = call("mantle.party.PartyServices.create#Person", { firstName: "Pay", lastName: "Roll", roleTypeId: "Employee" }).partyId
        partyRelationshipId = call("mantle.humanres.EmploymentServices.create#Employment",
                { fromPartyId: employeeId, toPartyId: organizationPartyId, timePeriodTypeId: "PayrollMonth",
                    taxFederalAllowances: 2, fromDate: effectiveTime }).partyRelationshipId
        const dataCheckErrors = checkData(`<entity-facade-xml>
            <mantle.party.PartyRelationship partyRelationshipId="${partyRelationshipId}" fromPartyId="${employeeId}"
                    toPartyId="${organizationPartyId}" fromRoleTypeId="Employee" toRoleTypeId="OrgEmployer"
                    relationshipTypeEnumId="PrtEmployee" fromDate="${effectiveTime}"/>
            <mantle.humanres.employment.Employment partyRelationshipId="${partyRelationshipId}" timePeriodTypeId="PayrollMonth"
                    taxFederalAllowances="2"/>
        </entity-facade-xml>`)
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) {
        partyRelationshipId != null
        dataCheckErrors.length == 0
    },
})

feature("an overlapping Employment is refused", {
    when() {
        return { error: errorOf("mantle.humanres.EmploymentServices.create#Employment",
                { fromPartyId: employeeId, toPartyId: organizationPartyId, fromDate: effectiveTime + 1000 }) }
    },
    then({ error }) {
        error != null
        error.includes("overlapping employments")
    },
})

feature("update Employment", {
    when() {
        call("mantle.humanres.EmploymentServices.update#Employment",
                { partyRelationshipId, fromPartyId: employeeId, toPartyId: organizationPartyId, fromDate: effectiveTime,
                    taxFederalAllowances: 3, taxStateAllowances: 1 })
        const dataCheckErrors = checkData(`<entity-facade-xml>
            <mantle.humanres.employment.Employment partyRelationshipId="${partyRelationshipId}" taxFederalAllowances="3"
                    taxStateAllowances="1"/>
        </entity-facade-xml>`)
        return { dataCheckErrors }
    },
    then({ dataCheckErrors }) { dataCheckErrors.length == 0 },
})

feature("create EmploymentSalary", {
    when() {
        const out = call("mantle.humanres.EmploymentServices.create#EmploymentSalary",
                { partyRelationshipId, amount: 5000, currencyUomId: "USD", fromDate: effectiveTime })
        const dataCheckErrors = checkData(`<entity-facade-xml>
            <mantle.humanres.employment.EmploymentSalary partyRelationshipId="${partyRelationshipId}" fromDate="${effectiveTime}"
                    amount="5000" currencyUomId="USD" timePeriodTypeId="PayrollMonth"/>
        </entity-facade-xml>`)
        return { out, dataCheckErrors }
    },
    then({ out, dataCheckErrors }) {
        out.fromDate != null
        dataCheckErrors.length == 0
    },
})

feature("check NextPayrollTimePeriods", {
    when() {
        call("mantle.humanres.EmploymentServices.check#NextPayrollTimePeriods", { organizationPartyId })
        const periods = ec.entity.find("mantle.party.time.TimePeriod").condition("partyId", organizationPartyId)
                .condition("timePeriodTypeId", "PayrollMonth").list()
        return { count: periods.length }
    },
    then({ count }) { count >= 2 },
})

feature("create and update RateAmount", {
    when() {
        rateAmountId = call("mantle.humanres.RateServices.create#RateAmount",
                { rateTypeEnumId: "RatpStandard", ratePurposeEnumId: "RaprVendor", partyId: employeeId,
                    rateAmount: "45.5", rateCurrencyUomId: "USD", fromDate: effectiveTime }).rateAmountId
        const created = checkData(`<entity-facade-xml>
            <mantle.humanres.rate.RateAmount rateAmountId="${rateAmountId}" partyId="${employeeId}" rateTypeEnumId="RatpStandard"
                    ratePurposeEnumId="RaprVendor" rateAmount="45.5" timePeriodUomId="TF_hr"/>
        </entity-facade-xml>`)
        call("mantle.humanres.RateServices.update#RateAmount", { rateAmountId, rateAmount: "50", thruDate: effectiveTime + 86400000 })
        const updated = checkData(`<entity-facade-xml>
            <mantle.humanres.rate.RateAmount rateAmountId="${rateAmountId}" rateAmount="50" thruDate="${effectiveTime + 86400000}"/>
        </entity-facade-xml>`)
        return { created, updated }
    },
    then({ created, updated }) {
        created.length == 0
        updated.length == 0
    },
})

feature("get PartyEmployersAndPositionClasses", {
    when() { return { out: call("mantle.humanres.PositionServices.get#PartyEmployersAndPositionClasses", { partyId: employeeId }) } },
    then({ out }) {
        out.employerRelList.length == 1
        out.employerRelList[0].toPartyId == organizationPartyId
        out.employerPartyList.length == 1
        out.emplPositionClassList.length >= 1
    },
})

feature("delete Employment", {
    when() {
        secondEmployeeId = call("mantle.party.PartyServices.create#Person", { firstName: "Short", lastName: "Stay" }).partyId
        const relId = call("mantle.humanres.EmploymentServices.create#Employment",
                { fromPartyId: secondEmployeeId, toPartyId: organizationPartyId, fromDate: effectiveTime }).partyRelationshipId
        call("mantle.humanres.EmploymentServices.delete#Employment", { partyRelationshipId: relId })
        const rel = ec.entity.find("mantle.party.PartyRelationship").condition("partyRelationshipId", relId).one()
        const empl = ec.entity.find("mantle.humanres.employment.Employment").condition("partyRelationshipId", relId).one()
        return { rel, empl }
    },
    then({ rel, empl }) {
        rel == null
        empl == null
    },
})
