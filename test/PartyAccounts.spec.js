// Party search, user account maintenance and notice counts (mantle.party.PartyServices) beyond what the earlier party spec
// covers. New spec, no Groovy original.
const effectiveTime = Date.now()
let personId, userId, strayUserId, badgeId, relationshipId

spec({
    stepwise: true,
    tempSequences: { start: 59200, banks: { "mantle.party.Party": 20, "mantle.party.PartyBadge": 10, "mantle.party.PartyRelationship": 10 } },
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

const account = (id) => ec.entity.find("moqui.security.UserAccount").condition("userId", id).one()

feature("a person with a user account, found by the person search", {
    when() {
        personId = call("mantle.party.PartyServices.create#Person", { firstName: "Searchy", lastName: "McSearchface" }).partyId
        userId = call("mantle.party.PartyServices.create#PartyUserAccount", { partyId: personId, emailAddress: "searchy@example.com", username: "searchy",
                newPassword: "moqui1!!", newPasswordVerify: "moqui1!!" }).userId
        const byFirst = call("mantle.party.PartyServices.search#Person", { term: "searchy" })
        const byLast = call("mantle.party.PartyServices.search#Person", { term: "mcsearch" })
        const none = call("mantle.party.PartyServices.search#Person", { term: "zzzznoonehasthisname" })
        return { byFirst, byLast, none }
    },
    then({ byFirst, byLast, none }) {
        byFirst.outList.some(item => item.value == personId)
        byLast.outList.length >= 1
        byLast.outList[0].label.includes("Searchy")
        none.outList.length == 0
    },
})

feature("party search over the index with several criteria, and the user notice counts", {
    when() {
        const empty = call("mantle.party.PartyServices.search#Party", {})
        const byName = call("mantle.party.PartyServices.search#Party", { anyField: "Searchy", roleTypeId: "Customer", partyClassificationId: "CustDistributor",
                pseudoId: "S", username: "searchy", disabled: "N", firstName: "Searchy", lastName: "McSearchface", city: "Orem", postalCode: "84", stateProvinceGeoId: "USA_UT",
                areaCode: "801", contactNumber: "555", address1: "Main", infoString: "searchy", partyTypeEnumId: "PtyPerson", customerStatusId: "_exists_", pageSize: 5,
                orderByField: "combinedName" })
        const counts = call("mantle.party.PartyServices.get#UserNoticeCounts", {})
        return { empty, byName, counts }
    },
    then({ empty, byName, counts }) {
        empty.queryString == null || empty.queryString == ""
        byName.queryString.includes("firstName:Searchy*")
        byName.queryString.includes("contactMechs.postalCode:84*")
        counts.partyId != null
        Number(counts.notificationCount) >= 0
        Number(counts.taskCount) >= 0
    },
})

feature("update#Account changes the person, user and primary email", {
    when() {
        call("mantle.party.PartyServices.update#Account", { partyId: personId, firstName: "Searchier", emailAddress: "searchier@example.com", timeZone: "America/Denver", locale: "en_US" })
        const byUser = call("mantle.party.PartyServices.update#Account", { userId, lastName: "Renamed" })
        const person = ec.entity.find("mantle.party.Person").condition("partyId", personId).one()
        const info = call("mantle.party.ContactServices.get#PartyContactInfo", { partyId: personId, emailContactMechPurposeId: "EmailPrimary" })
        return { person, user: account(userId), info }
    },
    then({ person, user, info }) {
        person.firstName == "Searchier"
        person.lastName == "Renamed"
        user.timeZone == "America/Denver"
        info.emailAddress == "searchier@example.com"
    },
})

feature("create a person for a user account with no party", {
    when() {
        strayUserId = call("create#moqui.security.UserAccount", { username: "stray.user", userFullName: "Stray Q User", emailAddress: "stray@example.com" }).userId
        const out = call("mantle.party.PartyServices.create#UserAccountPerson", { userId: strayUserId })
        const again = call("mantle.party.PartyServices.create#UserAccountPerson", { userId: strayUserId })
        const person = ec.entity.find("mantle.party.Person").condition("partyId", out.partyId).one()
        return { out, again, person, user: account(strayUserId) }
    },
    then({ out, again, person, user }) {
        out.partyId != null
        out.emailContactMechId != null
        person.firstName == "Stray Q"
        person.lastName == "User"
        user.partyId == out.partyId
        // a second call finds the party already there and does nothing
        again.partyId == null
    },
})

feature("badge info and party relationship settings", {
    when() {
        badgeId = call("create#mantle.party.PartyBadge", { partyId: personId, organizationPartyId: "ORG_ZIZI_RETAIL", fromDate: effectiveTime - 86400000, serialNumber: "PA-BADGE-1" }).partyBadgeId
        const info = call("mantle.party.PartyServices.get#PartyBadgeInfo", { partyBadgeId: badgeId })
        relationshipId = call("create#mantle.party.PartyRelationship", { fromPartyId: personId, fromRoleTypeId: "Employee", toPartyId: "ORG_ZIZI_RETAIL", toRoleTypeId: "OrgEmployer",
                relationshipTypeEnumId: "PrtEmployee", fromDate: effectiveTime - 86400000 }).partyRelationshipId
        call("mantle.party.PartyServices.store#PartyRelationshipSetting", { partySettingTypeId: "CustomerSingleLot", partyRelationshipId: relationshipId, settingValue: "BlY" })
        call("mantle.party.PartyServices.store#PartyRelationshipSetting", { partySettingTypeId: "CustomerSingleLot", partyRelationshipId: relationshipId, settingValue: "BlN" })
        const setting = ec.entity.find("mantle.party.PartyRelationshipSetting").condition("partyRelationshipId", relationshipId).condition("partySettingTypeId", "CustomerSingleLot").one()
        return { info, setting }
    },
    then({ info, setting }) {
        info.partyBadge.partyBadgeId == badgeId
        info.person.partyId == personId
        setting.settingValue == "BlN"
    },
})
