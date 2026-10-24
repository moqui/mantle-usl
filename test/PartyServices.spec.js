// Party services the flows do not reach: find, convert, detail updates, roles, classifications, settings, user accounts
// and badge scans. New spec, no Groovy original.
const effectiveTime = Date.now()
let personId, orgId, customerId, employeeId, badgeId, userId

spec({
    stepwise: true,
    tempSequences: { start: 56300, banks: { "mantle.party.Party": 20, "mantle.party.PartyBadge": 10, "mantle.work.time.TimeEntry": 10,
        "mantle.party.PartyBadgeScan": 10 } },
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

feature("create PersonCustomer and PersonEmployee", {
    when() {
        customerId = call("mantle.party.PartyServices.create#PersonCustomer", { firstName: "Cathy", lastName: "Customer",
                address1: "5 Cust Ave", city: "Orem", stateProvinceGeoId: "USA_UT", postalCode: "84057", countryGeoId: "USA",
                countryCode: "1", areaCode: "801", contactNumber: "555-0300", emailAddress: "cathy@example.com" }).partyId
        employeeId = call("mantle.party.PartyServices.create#PersonEmployee", { firstName: "Eddie", lastName: "Employee",
                emailAddress: "eddie@example.com" }).partyId
        const roles = ec.entity.find("mantle.party.PartyRole").condition("partyId", customerId).list().map(r => r.roleTypeId)
        const empRoles = ec.entity.find("mantle.party.PartyRole").condition("partyId", employeeId).list().map(r => r.roleTypeId)
        const info = call("mantle.party.ContactServices.get#PartyContactInfo", { partyId: customerId,
                postalContactMechPurposeId: "PostalPrimary", emailContactMechPurposeId: "EmailPrimary" })
        return { roles, empRoles, info }
    },
    then({ roles, empRoles, info }) {
        customerId != null
        employeeId != null
        roles.includes("Customer")
        empRoles.includes("Employee")
        info.postalAddress.city == "Orem"
        info.emailAddress == "cathy@example.com"
    },
})

feature("find#Party by name, email and role", {
    when() {
        const byName = call("mantle.party.PartyServices.find#Party", { firstName: "Cathy", lastName: "Customer" })
        const byEmail = call("mantle.party.PartyServices.find#Party", { emailAddress: "eddie@example.com" })
        const byRole = call("mantle.party.PartyServices.find#Party", { roleTypeId: "Employee", lastName: "Employee" })
        const none = call("mantle.party.PartyServices.find#Party", { lastName: "NoSuchPersonAnywhere" })
        return { byName, byEmail, byRole, none }
    },
    then({ byName, byEmail, byRole, none }) {
        byName.partyIdList.includes(customerId)
        byEmail.partyIdList.includes(employeeId)
        byRole.partyIdList.includes(employeeId)
        none.partyIdList.length == 0
    },
})

feature("update#PartyDetail and ensure#PartyRole", {
    when() {
        call("mantle.party.PartyServices.update#PartyDetail", { partyId: customerId, firstName: "Catherine", comments: "VIP" })
        const person = ec.entity.find("mantle.party.Person").condition("partyId", customerId).one()
        const party = ec.entity.find("mantle.party.Party").condition("partyId", customerId).one()
        call("mantle.party.PartyServices.ensure#PartyRole", { partyId: customerId, roleTypeId: "Supplier" })
        call("mantle.party.PartyServices.ensure#PartyRole", { partyId: customerId, roleTypeId: "Supplier" })
        const roles = ec.entity.find("mantle.party.PartyRole").condition("partyId", customerId).condition("roleTypeId", "Supplier").list()
        return { person, party, roles }
    },
    then({ person, party, roles }) {
        person.firstName == "Catherine"
        person.lastName == "Customer"
        party.partyTypeEnumId == "PtyPerson"
        roles.length == 1
    },
})

feature("set and remove PartyClassification", {
    when() {
        call("mantle.party.PartyServices.set#PartyClassification", { partyId: customerId, partyClassificationId: "CustDistributor" })
        const set = ec.entity.find("mantle.party.PartyClassificationAppl").condition("partyId", customerId)
                .condition("partyClassificationId", "CustDistributor").list()
        call("mantle.party.PartyServices.remove#PartyClassification", { partyId: customerId, partyClassificationId: "CustDistributor" })
        const open = ec.entity.find("mantle.party.PartyClassificationAppl").condition("partyId", customerId)
                .condition("partyClassificationId", "CustDistributor").condition("thruDate", null).list()
        return { set, open }
    },
    then({ set, open }) {
        set.length == 1
        open.length == 0
    },
})

feature("store and validate PartySetting", {
    when() {
        call("mantle.party.PartyServices.store#PartySetting", { partySettingTypeId: "CustomerSingleLot", partyId: customerId, settingValue: "BlY" })
        const first = ec.entity.find("mantle.party.PartySetting").condition("partyId", customerId).condition("partySettingTypeId", "CustomerSingleLot").one()
        call("mantle.party.PartyServices.store#PartySetting", { partySettingTypeId: "CustomerSingleLot", partyId: customerId, settingValue: "BlN" })
        const second = ec.entity.find("mantle.party.PartySetting").condition("partyId", customerId).condition("partySettingTypeId", "CustomerSingleLot").one()
        const valid = errorOf("mantle.party.PartyServices.validate#PartySetting", { partySettingTypeId: "CustomerSingleLot", settingValue: "BlN", partyId: customerId })
        const invalid = errorOf("mantle.party.PartyServices.validate#PartySetting", { partySettingTypeId: "CustomerSingleLot", settingValue: "Maybe", partyId: customerId })
        return { first, second, valid, invalid }
    },
    then({ first, second, valid, invalid }) {
        first.settingValue == "BlY"
        second.settingValue == "BlN"
        valid == null
        invalid.includes("is not valid")
    },
})

feature("convert Person to Organization and back", {
    when() {
        orgId = call("mantle.party.PartyServices.create#Person", { firstName: "Olive", lastName: "Orgson" }).partyId
        call("mantle.party.PartyServices.convert#PartyToOrganization", { partyId: orgId })
        const org = ec.entity.find("mantle.party.Organization").condition("partyId", orgId).one()
        const person = ec.entity.find("mantle.party.Person").condition("partyId", orgId).one()
        const party = ec.entity.find("mantle.party.Party").condition("partyId", orgId).one()
        call("mantle.party.PartyServices.convert#PartyToPerson", { partyId: orgId, firstName: "Olive", lastName: "Orgson" })
        const org2 = ec.entity.find("mantle.party.Organization").condition("partyId", orgId).one()
        const person2 = ec.entity.find("mantle.party.Person").condition("partyId", orgId).one()
        const party2 = ec.entity.find("mantle.party.Party").condition("partyId", orgId).one()
        return { org, person, party, org2, person2, party2 }
    },
    then({ org, person, party, org2, person2, party2 }) {
        org.organizationName == "Olive Orgson"
        person == null
        party.partyTypeEnumId == "PtyOrganization"
        org2 == null
        person2.firstName == "Olive"
        party2.partyTypeEnumId == "PtyPerson"
    },
})

feature("create PartyUserAccount, update it, and get PartyOrganizationInfo", {
    when() {
        userId = call("mantle.party.PartyServices.create#PartyUserAccount", { partyId: employeeId, emailAddress: "eddie.login@example.com",
                username: "eddie.login", newPassword: "moqui1!!", newPasswordVerify: "moqui1!!" }).userId
        const created = ec.entity.find("moqui.security.UserAccount").condition("userId", userId).one()
        call("mantle.party.PartyServices.update#PartyUserAccount", { userId, partyId: employeeId, emailAddress: "eddie.new@example.com" })
        const updated = ec.entity.find("moqui.security.UserAccount").condition("userId", userId).one()
        const orgInfo = call("mantle.party.PartyServices.get#PartyOrganizationInfo", { partyId: employeeId })
        return { created, updated, orgInfo }
    },
    then({ created, updated, orgInfo }) {
        userId != null
        created.username == "eddie.login"
        created.partyId == employeeId
        updated.emailAddress == "eddie.new@example.com"
        orgInfo.userOrgIds != null
    },
})

feature("badge lookup and scans: access, clock in, clock out, expired", {
    when() {
        badgeId = call("create#mantle.party.PartyBadge", { partyId: employeeId, organizationPartyId: "ORG_ZIZI_RETAIL",
                fromDate: effectiveTime - 86400000, serialNumber: "BADGE-" + effectiveTime }).partyBadgeId
        const lookup = call("mantle.party.PartyServices.lookup#PartyBadge", { scanValue: "BADGE-" + effectiveTime })
        const access = call("mantle.party.PartyServices.scan#PartyBadge", { scanValue: "BADGE-" + effectiveTime, scanDate: effectiveTime - 3600000 })
        const clockIn = call("mantle.party.PartyServices.scan#PartyBadge", { scanValue: badgeId, scanPurposeEnumId: "PbspClockIn", scanDate: effectiveTime })
        const clockOut = call("mantle.party.PartyServices.scan#PartyBadge", { scanValue: badgeId, scanPurposeEnumId: "PbspClockOut",
                scanDate: effectiveTime + 2 * 3600000 })
        const timeEntry = ec.entity.find("mantle.work.time.TimeEntry").condition("timeEntryId", clockIn.timeEntryId).one()
        const expiredId = call("create#mantle.party.PartyBadge", { partyId: employeeId, organizationPartyId: "ORG_ZIZI_RETAIL",
                fromDate: effectiveTime - 2 * 86400000, thruDate: effectiveTime - 86400000, serialNumber: "OLD-" + effectiveTime }).partyBadgeId
        const expired = errorOf("mantle.party.PartyServices.scan#PartyBadge", { scanValue: "OLD-" + effectiveTime })
        return { lookup, access, clockIn, clockOut, timeEntry, expired }
    },
    then({ lookup, access, clockIn, clockOut, timeEntry, expired }) {
        lookup.partyBadge.partyBadgeId == badgeId
        access.scanResultEnumId == "PbsrSuccess"
        access.partyId == employeeId
        clockIn.timeEntryId != null
        clockOut.closedTimeEntryId == clockIn.timeEntryId
        timeEntry.thruDate != null
        expired.includes("Badge expired")
    },
})
