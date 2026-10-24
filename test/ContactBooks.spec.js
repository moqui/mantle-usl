// Contact books and personal contacts (mantle.party.ContactBookServices), contact import and export
// (mantle.party.ContactImportServices), the privacy of a personal contact on every party path (Party.privateOwnerUserId:
// the entity filters, find#Party, search#Party, search#Universal, lookup#ById, search#Person, the duplicate scan), and
// merge#Parties moving the party rows it left behind: the Mantle side of IronStone M4. New spec, no Groovy original.
const effectiveTime = Date.now()
const dayMillis = 86400000
const minute = 60000
// each step at its own minute, so date-keyed rows (book members, contact mechanisms) do not collide
const at = (minutes) => ec.user.setEffectiveTime(effectiveTime + minutes * minute)
const PARTY = "mantle.party.Party"
let averyUserId, blakeUserId, caseyUserId, averyPartyId
let defaultBookId, familyBookId, teamBookId, teamShareId, friendsGroupId
let privateId, grandmaId, robinId, directoryQuinnId, directoryAcmeId
let ginaId, oliveId

spec({
    stepwise: true,
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() {
        ec.artifactExecution.enableAuthz()
        login("john.doe")
    },
})

function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    return null
}
// run as one of the spec's users (authz stays disabled, so only the services' own conditions apply)
function as(username, run) {
    login(username, "moqui1!!")
    try { return run() } finally { login("john.doe") }
}
// run as a user with authz on, as a screen would: the user's organizations in the user context, the services authorized
// by the CBK_FILTERED authz and its entity filter set
function filteredAs(username, run, activeOrgId) {
    login(username, "moqui1!!")
    call("mantle.party.PartyServices.setup#UserOrganizationInfo", {})
    if (activeOrgId) ec.user.context.activeOrgId = activeOrgId
    ec.artifactExecution.enableAuthz()
    try { return run() } finally {
        ec.artifactExecution.disableAuthz()
        for (const name of ["userOrgIds", "filterOrgIds", "activeOrgId"]) delete ec.user.context[name]
        login("john.doe")
    }
}
// a party the user's entity finds see: update#PartyDetail finds it with a plain find (no condition of its own on
// privateOwnerUserId) and fails when the find returns nothing
function updatesParty(partyId) {
    try {
        call("mantle.party.PartyServices.update#PartyDetail", { partyId, comments: `Updated by ${ec.user.username}` })
        return true
    } catch (e) { ec.message.clearErrors(); return false }
}
// a party the Chatter's record check sees (get#RecordLinkInfo: the entity filters and its own personal contact condition)
function seesParty(partyId) {
    try {
        call("mantle.party.CommunicationServices.get#RecordLinkInfo", { recordEntityName: PARTY, recordId: partyId })
        return true
    } catch (e) { ec.message.clearErrors(); return false }
}
function indexParty(partyId) { ec.search.indexDocuments(ec.entity.getDataDocuments("MantleParty", { partyId })) }
const searchParty = (text) => (call("mantle.party.PartyServices.search#Party", { anyField: text, pageSize: 50 }).documentList || [])
        .map((doc) => doc.partyId || doc._id)
const searchUniversal = (text) => (call("mantle.search.UniversalSearchServices.search#Universal", { q: text, entityType: "MantleParty",
        limit: 50, highlight: false }).results || []).map((result) => result.key.partyId)
const findParty = (params) => call("mantle.party.PartyServices.find#Party", Object.assign({ pageSize: 50 }, params)).partyIdList
const members = (contactBookId, params) => call("mantle.party.ContactBookServices.find#ContactBookParties",
        Object.assign({ contactBookId, pageNoLimit: true }, params || {}))
// a date field's UTC day (dates reach scripts as epoch millis text)
const dayOf = (value) => value == null ? null : new Date(Number(value)).toISOString().substring(0, 10)
const countOf = (entityName, fields) => ec.entity.find(entityName).condition(fields).count()
const currentCount = (entityName, fields) => ec.entity.find(entityName).condition(fields)
        .condition(ec.entity.conditionFactory.makeConditionDate("fromDate", "thruDate", null)).count()

feature("three employees of an organization, a team group and an authz with the user organization filter", {
    when() {
        call("create#moqui.security.UserGroup", { userGroupId: "CBK_FILTERED", description: "Contact books filter test" })
        call("create#moqui.security.UserGroup", { userGroupId: "CBK_TEAM", description: "Contact books team" })
        call("create#moqui.security.ArtifactGroup", { artifactGroupId: "CBK_FILTERED", description: "Contact books filter test" })
        for (const artifactName of ["mantle.party.CommunicationServices.get#RecordLinkInfo", "mantle.GeneralServices.lookup#ById",
            "mantle.party.PartyServices.find#Party", "mantle.party.PartyServices.search#Party", "mantle.party.PartyServices.update#PartyDetail",
            "mantle.search.UniversalSearchServices.search#Universal"]) {
            call("create#moqui.security.ArtifactGroupMember", { artifactGroupId: "CBK_FILTERED", artifactTypeEnumId: "AT_SERVICE",
                    artifactName, nameIsPattern: "N", inheritAuthz: "Y" })
        }
        call("create#moqui.security.ArtifactAuthz", { artifactAuthzId: "CBK_FILTERED", userGroupId: "CBK_FILTERED", artifactGroupId: "CBK_FILTERED",
                authzTypeEnumId: "AUTHZT_ALLOW", authzActionEnumId: "AUTHZA_ALL" })
        call("create#moqui.security.ArtifactAuthzFilter", { artifactAuthzId: "CBK_FILTERED", entityFilterSetId: "MANTLE_USER_ORG" })
        const userIds = {}
        for (const [first, username] of [["Avery", "cbk.avery"], ["Blake", "cbk.blake"], ["Casey", "cbk.casey"]]) {
            const partyId = call("mantle.party.PartyServices.create#Person", { firstName: first, lastName: "Bookkeeper" }).partyId
            const userId = call("mantle.party.PartyServices.create#PartyUserAccount", { partyId, emailAddress: `${username}@example.com`, username,
                    newPassword: "moqui1!!", newPasswordVerify: "moqui1!!" }).userId
            call("create#mantle.party.PartyRelationship", { relationshipTypeEnumId: "PrtEmployee", fromPartyId: partyId, fromRoleTypeId: "Employee",
                    toPartyId: "ORG_ZIZI_RETAIL", toRoleTypeId: "OrgInternal", fromDate: effectiveTime - dayMillis })
            call("create#moqui.security.UserGroupMember", { userGroupId: "CBK_FILTERED", userId, fromDate: effectiveTime - dayMillis })
            userIds[first] = userId
            if (first === "Avery") averyPartyId = partyId
        }
        call("create#moqui.security.UserGroupMember", { userGroupId: "CBK_TEAM", userId: userIds.Casey, fromDate: effectiveTime - dayMillis })
        averyUserId = userIds.Avery; blakeUserId = userIds.Blake; caseyUserId = userIds.Casey
        // directory parties the books and the merge use
        directoryAcmeId = call("mantle.party.PartyServices.create#Organization", { organizationName: "Bookkeeper Supply", roleTypeId: "Supplier" }).partyId
        directoryQuinnId = call("mantle.party.PartyServices.create#Person", { firstName: "Quinn", lastName: "Directory", roleTypeId: "Customer" }).partyId
        return { searchAvailable: ec.search.isAvailable() }
    },
    then({ searchAvailable }) {
        searchAvailable
        averyUserId != null
        blakeUserId != null
        caseyUserId != null
    },
})

feature("a user's first personal book is the default, made on first use; another can take the default", {
    when() {
        at(1)
        return as("cbk.avery", () => {
            const first = call("mantle.party.ContactBookServices.ensure#UserDefaultContactBook", {})
            const again = call("mantle.party.ContactBookServices.ensure#UserDefaultContactBook", {})
            defaultBookId = first.contactBookId
            familyBookId = call("mantle.party.ContactBookServices.create#ContactBook", { contactBookName: "Family", color: "#e53935" }).contactBookId
            const family = ec.entity.find("mantle.party.contact.ContactBook").condition("contactBookId", familyBookId).one()
            call("mantle.party.ContactBookServices.update#ContactBook", { contactBookId: familyBookId, isDefault: "Y" })
            const defaultsAfter = Array.from(ec.entity.find("mantle.party.contact.ContactBook").condition("ownerUserId", averyUserId)
                    .condition("isDefault", "Y").list()).map((book) => book.contactBookId)
            call("mantle.party.ContactBookServices.update#ContactBook", { contactBookId: defaultBookId, isDefault: "Y" })
            const deleteDefault = errorOf("mantle.party.ContactBookServices.delete#ContactBook", { contactBookId: defaultBookId })
            return { first, again, family, defaultsAfter, deleteDefault }
        })
    },
    then({ first, again, family, defaultsAfter, deleteDefault }) {
        first.created == true
        again.created == false
        again.contactBookId == first.contactBookId
        family.isDefault == "N"
        family.ownerUserId == averyUserId
        family.visibilityEnumId == "CbvPersonal"
        defaultsAfter == [familyBookId]
        deleteDefault.includes("default book cannot be deleted")
    },
})

feature("another user cannot see a personal book", {
    when() {
        return as("cbk.blake", () => ({
            view: errorOf("mantle.party.ContactBookServices.find#ContactBookParties", { contactBookId: familyBookId }),
            books: call("mantle.party.ContactBookServices.get#UserContactBooks", {}).contactBookList.map((book) => book.contactBookId),
        }))
    },
    then({ view, books }) {
        view.includes(`Contact book ${familyBookId} not found`)
        !books.includes(familyBookId)
        !books.includes(defaultBookId)
    },
})

feature("a shared book: view, edit and manage shares for a user and a user group", {
    when() {
        at(2)
        const created = as("cbk.avery", () => call("mantle.party.ContactBookServices.create#ContactBook", { contactBookName: "Team Book",
                visibilityEnumId: "CbvShared", ownerPartyId: "ORG_ZIZI_RETAIL" }))
        teamBookId = created.contactBookId
        teamShareId = created.contactBookShareId
        const out = as("cbk.avery", () => {
            call("mantle.party.ContactBookServices.share#ContactBook", { contactBookId: teamBookId, userId: blakeUserId })
            call("mantle.party.ContactBookServices.share#ContactBook", { contactBookId: teamBookId, userGroupId: "CBK_TEAM", permissionEnumId: "CbpEdit" })
            const lastManager = errorOf("mantle.party.ContactBookServices.unshare#ContactBook", { contactBookId: teamBookId, userId: averyUserId })
            return { lastManager }
        })
        out.blake = as("cbk.blake", () => ({
            access: call("mantle.party.ContactBookServices.check#ContactBookAccess", { contactBookId: teamBookId }).userPermissionEnumId,
            view: members(teamBookId).contactListCount,
            add: errorOf("mantle.party.ContactBookServices.add#ContactBookParties", { contactBookId: teamBookId, partyId: directoryAcmeId }),
            books: call("mantle.party.ContactBookServices.get#UserContactBooks", {}).contactBookList,
        }))
        at(3)
        out.casey = as("cbk.casey", () => ({
            access: call("mantle.party.ContactBookServices.check#ContactBookAccess", { contactBookId: teamBookId }).userPermissionEnumId,
            add: call("mantle.party.ContactBookServices.add#ContactBookParties", { contactBookId: teamBookId,
                    partyIdList: [directoryAcmeId, directoryQuinnId] }),
            share: errorOf("mantle.party.ContactBookServices.share#ContactBook", { contactBookId: teamBookId, userId: caseyUserId,
                    permissionEnumId: "CbpManage" }),
        }))
        out.shares = Array.from(ec.entity.find("mantle.party.contact.ContactBookShare").condition("contactBookId", teamBookId)
                .orderBy("contactBookShareId").list()).map((share) => `${share.userId || share.userGroupId}:${share.permissionEnumId}`)
        return out
    },
    then({ lastManager, blake, casey, shares }) {
        teamShareId != null
        lastManager.includes("at least one manage share")
        shares.length == 3
        shares.includes(`${averyUserId}:CbpManage`)
        shares.includes(`${blakeUserId}:CbpView`)
        shares.includes("CBK_TEAM:CbpEdit")
        blake.access == "CbpView"
        blake.view == 0
        blake.add.includes("You need edit permission")
        blake.books.length == 1
        blake.books[0].contactBookId == teamBookId
        blake.books[0].permissionEnumId == "CbpView"
        blake.books[0].isOwner == false
        casey.access == "CbpEdit"
        casey.add.addedCount == 2
        casey.share.includes("You need manage permission")
    },
})

feature("groups in a book, favorites and the member list with its filters and counts", {
    when() {
        at(4)
        return as("cbk.casey", () => {
            const created = call("mantle.party.ContactBookServices.create#ContactBookGroup", { contactBookId: teamBookId, groupName: "Vendors" })
            const again = call("mantle.party.ContactBookServices.create#ContactBookGroup", { contactBookId: teamBookId, groupName: "vendors" })
            call("mantle.party.ContactBookServices.add#ContactBookGroupParties", { contactBookGroupId: created.contactBookGroupId, partyId: directoryAcmeId })
            call("mantle.party.ContactBookServices.set#ContactFavorite", { contactBookId: teamBookId, partyId: directoryQuinnId })
            const all = members(teamBookId)
            const vendors = members(teamBookId, { contactBookGroupId: created.contactBookGroupId })
            const favorites = members(teamBookId, { favoritesOnly: true })
            const byName = members(teamBookId, { text: "supply" })
            const books = call("mantle.party.ContactBookServices.get#UserContactBooks", {}).contactBookList
            call("mantle.party.ContactBookServices.update#ContactBookGroup", { contactBookGroupId: created.contactBookGroupId, groupName: "Suppliers" })
            const renamed = ec.entity.find("mantle.party.contact.ContactBookGroup").condition("contactBookGroupId", created.contactBookGroupId).one()
            call("mantle.party.ContactBookServices.remove#ContactBookGroupParties", { contactBookGroupId: created.contactBookGroupId, partyId: directoryAcmeId })
            const afterRemove = members(teamBookId, { contactBookGroupId: created.contactBookGroupId }).contactListCount
            return { created, again, all, vendors, favorites, byName, books, renamed, afterRemove }
        })
    },
    then({ created, again, all, vendors, favorites, byName, books, renamed, afterRemove }) {
        created.created == true
        again.created == false
        again.contactBookGroupId == created.contactBookGroupId
        all.contactListCount == 2
        all.contactList.map((contact) => contact.partyId).sort() == [directoryAcmeId, directoryQuinnId].sort()
        vendors.contactList.map((contact) => contact.partyId) == [directoryAcmeId]
        vendors.contactList[0].groupList[0].groupName == "Vendors"
        vendors.contactList[0].organizationName == "Bookkeeper Supply"
        favorites.contactList.map((contact) => contact.partyId) == [directoryQuinnId]
        favorites.contactList[0].isFavorite == true
        byName.contactList.map((contact) => contact.partyId) == [directoryAcmeId]
        books[0].contactBookId == teamBookId
        books[0].partyCount == 2
        books[0].favoriteCount == 1
        books[0].groupCount == 1
        books[0].groupList[0].partyCount == 1
        renamed.groupName == "Suppliers"
        afterRemove == 0
    },
})

feature("a personal contact: in a personal book, owned by its user, never in a shared book", {
    when() {
        at(5)
        return as("cbk.avery", () => {
            const created = call("mantle.party.ContactBookServices.create#PersonalContact", { firstName: "Quinn", lastName: "Privateer",
                    emailAddress: "quinn.privateer@example.com", countryCode: "1", areaCode: "801", contactNumber: "555-8133",
                    organizationPartyId: directoryAcmeId, jobTitle: "Buyer" })
            privateId = created.partyId
            grandmaId = call("mantle.party.ContactBookServices.create#PersonalContact", { contactBookId: familyBookId, firstName: "Grandma",
                    isFavorite: "Y" }).partyId
            robinId = call("mantle.party.ContactBookServices.create#PersonalContact", { firstName: "Robin", lastName: "Linkable",
                    emailAddress: "robin.linkable@example.com" }).partyId
            const intoShared = errorOf("mantle.party.ContactBookServices.create#PersonalContact", { contactBookId: teamBookId, firstName: "Not", lastName: "Shared" })
            const addShared = call("mantle.party.ContactBookServices.add#ContactBookParties", { contactBookId: teamBookId, partyId: privateId })
            const party = ec.entity.find(PARTY).condition("partyId", privateId).one()
            const grandma = ec.entity.find("mantle.party.Person").condition("partyId", grandmaId).one()
            const listed = members(defaultBookId)
            const byPhone = members(defaultBookId, { text: "555-8133" }).contactList.map((contact) => contact.partyId)
            const byEmail = members(defaultBookId, { text: "robin.link" }).contactList.map((contact) => contact.partyId)
            return { created, party, grandma, intoShared, addShared, listed, byPhone, byEmail }
        })
    },
    then({ created, party, grandma, intoShared, addShared, listed, byPhone, byEmail }) {
        created.contactBookId == defaultBookId
        party.privateOwnerUserId == averyUserId
        party.ownerPartyId == "_NA_"
        countOf("mantle.party.PartyRole", { partyId: privateId }) == 0
        grandma.firstName == "Grandma"
        grandma.lastName == null
        intoShared.includes("goes in one of your personal books")
        addShared.addedCount == 0
        addShared.failedPartyIdList == [privateId]
        currentCount("mantle.party.contact.ContactBookParty", { contactBookId: teamBookId, partyId: privateId }) == 0
        listed.contactList.map((contact) => contact.partyId).sort() == [privateId, robinId].sort()
        listed.contactList.find((contact) => contact.partyId === privateId).isPersonal == true
        listed.contactList.find((contact) => contact.partyId === privateId).emailAddress == "quinn.privateer@example.com"
        listed.contactList.find((contact) => contact.partyId === privateId).phone == "+1 801 555-8133"
        listed.contactList.find((contact) => contact.partyId === privateId).organizationName == "Bookkeeper Supply"
        listed.contactList.find((contact) => contact.partyId === privateId).jobTitle == "Buyer"
        byPhone == [privateId]
        byEmail == [robinId]
    },
})

feature("another user never sees a personal contact: find#Party, lookup#ById, search#Person, search#Party, search#Universal", {
    when() {
        indexParty(privateId)
        indexParty(directoryQuinnId)
        const run = () => ({
            find: findParty({ combinedName: "Privateer" }),
            findOnly: findParty({ lastName: "Privateer", personalContacts: "only" }),
            findExclude: findParty({ lastName: "Privateer", personalContacts: "exclude" }),
            lookup: call("mantle.GeneralServices.lookup#ById", { lookupId: privateId }).partyId ?? null,
            person: call("mantle.party.PartyServices.search#Person", { term: "Privateer" }).outList.map((item) => item.value),
            search: searchParty("Privateer"),
            universal: searchUniversal("Privateer"),
        })
        return { avery: as("cbk.avery", run), blake: as("cbk.blake", run), johnDoe: run() }
    },
    then({ avery, blake, johnDoe }) {
        avery.find.includes(privateId)
        avery.findOnly.includes(privateId)
        !avery.findExclude.includes(privateId)
        avery.lookup == privateId
        avery.person.includes(privateId)
        avery.search.includes(privateId)
        avery.universal.includes(privateId)
        !blake.find.includes(privateId)
        blake.findOnly.length == 0
        blake.lookup == null
        !blake.person.includes(privateId)
        !blake.search.includes(privateId)
        !blake.universal.includes(privateId)
        !johnDoe.find.includes(privateId)
        !johnDoe.search.includes(privateId)
    },
})

feature("under the user organization filter an entity find, lookup#ById and the searches leave out another user's personal contact", {
    when() {
        const run = () => ({ updates: updatesParty(privateId), updatesDirectory: updatesParty(directoryQuinnId),
            sees: seesParty(privateId), seesDirectory: seesParty(directoryQuinnId),
            lookup: call("mantle.GeneralServices.lookup#ById", { lookupId: privateId }).partyId ?? null,
            search: searchParty("Privateer"), universal: searchUniversal("Privateer") })
        const out = { avery: filteredAs("cbk.avery", run), blake: filteredAs("cbk.blake", run) }
        // without the filter get#RecordLinkInfo's own condition still leaves it out
        out.blakeUnfiltered = as("cbk.blake", () => seesParty(privateId))
        out.comments = ec.entity.find(PARTY).condition("partyId", privateId).one().comments
        return out
    },
    then({ avery, blake, blakeUnfiltered, comments }) {
        avery.updates == true
        avery.updatesDirectory == true
        blake.updates == false
        blake.updatesDirectory == true
        comments == "Updated by cbk.avery"
        blakeUnfiltered == false
        avery.sees == true
        avery.seesDirectory == true
        avery.lookup == privateId
        avery.search.includes(privateId)
        avery.universal.includes(privateId)
        blake.sees == false
        blake.seesDirectory == true
        blake.lookup == null
        !blake.search.includes(privateId)
        !blake.universal.includes(privateId)
    },
})

feature("under the active organization filter too, with find#Party on its view", {
    when() {
        const filter = ec.entity.find("moqui.security.ArtifactAuthzFilter").condition("artifactAuthzId", "CBK_FILTERED").one()
        filter.delete()
        call("create#moqui.security.ArtifactAuthzFilter", { artifactAuthzId: "CBK_FILTERED", entityFilterSetId: "MANTLE_ACTIVE_ORG" })
        const run = () => ({ updates: updatesParty(privateId), sees: seesParty(privateId), find: findParty({ combinedName: "Privateer" }) })
        return { avery: filteredAs("cbk.avery", run, "ORG_ZIZI_RETAIL"), blake: filteredAs("cbk.blake", run, "ORG_ZIZI_RETAIL") }
    },
    then({ avery, blake }) {
        avery.updates == true
        avery.sees == true
        avery.find.includes(privateId)
        blake.updates == false
        blake.sees == false
        !blake.find.includes(privateId)
    },
})

feature("as the IronStone apps' authz has it, the private contact set hides a personal contact with no active organization", {
    when() {
        ec.entity.find("moqui.security.ArtifactAuthzFilter").condition("artifactAuthzId", "CBK_FILTERED").deleteAll()
        for (const entityFilterSetId of ["MANTLE_ACTIVE_ORG", "MANTLE_PRIVATE_CONTACT"])
            call("create#moqui.security.ArtifactAuthzFilter", { artifactAuthzId: "CBK_FILTERED", entityFilterSetId })
        // no active organization: MANTLE_ACTIVE_ORG does not apply, MANTLE_PRIVATE_CONTACT does
        const run = () => { delete ec.user.context.activeOrgId; return { updates: updatesParty(privateId), sees: seesParty(privateId) } }
        return { avery: filteredAs("cbk.avery", run), blake: filteredAs("cbk.blake", run) }
    },
    then({ avery, blake }) {
        avery.updates == true
        avery.sees == true
        blake.updates == false
        blake.sees == false
    },
})

feature("the duplicate scan leaves out personal contacts", {
    when() {
        at(6)
        // a directory party with the personal contact's email: neither is the other's duplicate
        call("mantle.party.ContactServices.create#EmailAddress", { partyId: directoryQuinnId, emailAddress: "quinn.privateer@example.com",
                contactMechPurposeId: "EmailPrimary" })
        const directoryDups = call("mantle.party.DuplicateServices.find#PartyDuplicates", { partyId: directoryQuinnId }).matchingInfoByPartyId
        const directoryHas = call("mantle.party.DuplicateServices.find#PartyHasDuplicates", { partyId: directoryQuinnId }).hasDuplicates
        const personalDups = call("mantle.party.DuplicateServices.find#PartyDuplicates", { partyId: privateId }).matchingInfoByPartyId
        const personalHas = call("mantle.party.DuplicateServices.find#PartyHasDuplicates", { partyId: privateId }).hasDuplicates
        call("mantle.party.DuplicateServices.check#AllPartyDuplicates", {})
        const party = ec.entity.find(PARTY).condition("partyId", privateId).one()
        const blakeMerge = as("cbk.blake", () => {
            call("mantle.party.DuplicateServices.merge#Parties", { toPartyId: directoryQuinnId, fromPartyId: privateId })
            return ec.entity.find(PARTY).condition("partyId", privateId).one().mergedToPartyId ?? null
        })
        const intoPersonal = as("cbk.avery", () => errorOf("mantle.party.DuplicateServices.merge#Parties",
                { toPartyId: privateId, fromPartyId: directoryQuinnId }))
        return { directoryDups, directoryHas, personalDups, personalHas, party, blakeMerge, intoPersonal }
    },
    then({ directoryDups, directoryHas, personalDups, personalHas, party, blakeMerge, intoPersonal }) {
        !Object.keys(directoryDups).includes(privateId)
        directoryHas == false
        Object.keys(personalDups).length == 0
        personalHas == false
        party.hasDuplicates == null
        party.lastDupCheckDate == null
        blakeMerge == null
        intoPersonal.includes("cannot be merged into personal contact")
    },
})

feature("a personal contact linked to the directory: by clearing its owner, or merged into a directory party", {
    when() {
        at(7)
        const out = as("cbk.avery", () => {
            const cleared = call("mantle.party.ContactBookServices.link#PersonalContactToDirectory", { partyId: robinId, roleTypeId: "Customer" })
            const merged = call("mantle.party.ContactBookServices.link#PersonalContactToDirectory", { partyId: privateId, targetPartyId: directoryQuinnId })
            return { cleared, merged, listed: members(defaultBookId).contactList.map((contact) => contact.partyId).sort() }
        })
        out.blakeFinds = as("cbk.blake", () => findParty({ lastName: "Linkable" }))
        out.robin = ec.entity.find(PARTY).condition("partyId", robinId).one()
        out.quinn = ec.entity.find(PARTY).condition("partyId", privateId).one()
        return out
    },
    then({ cleared, merged, listed, blakeFinds, robin, quinn }) {
        cleared.directoryPartyId == robinId
        cleared.merged == false
        robin.privateOwnerUserId == null
        countOf("mantle.party.PartyRole", { partyId: robinId, roleTypeId: "Customer" }) == 1
        blakeFinds.includes(robinId)
        merged.directoryPartyId == directoryQuinnId
        merged.merged == true
        quinn.disabled == "Y"
        quinn.mergedToPartyId == directoryQuinnId
        // the personal contact's book membership moved to the directory party
        listed == [directoryQuinnId, robinId].sort()
        currentCount("mantle.party.contact.ContactBookParty", { contactBookId: defaultBookId, partyId: privateId }) == 0
    },
})

const googleCsv = [
    "First Name,Middle Name,Last Name,Nickname,Organization Name,Organization Title,Birthday,Notes,Labels,E-mail 1 - Label,E-mail 1 - Value,"
        + "E-mail 2 - Label,E-mail 2 - Value,Phone 1 - Label,Phone 1 - Value,Address 1 - Label,Address 1 - Street,Address 1 - City,"
        + "Address 1 - Region,Address 1 - Postal Code,Address 1 - Country",
    "Gina,,Googler,,Googler Widgets,Buyer,1985-04-12,\"Met at the fair, 2024\",* myContacts ::: Friends ::: * starred,* Home,"
        + "gina.googler@example.com,Work,gina@widgets.example.com,Mobile,+1 801-555-8142,Home,12 Elm St,Provo,UT,84601,United States",
    "Hank,,Googler,,,,--06-01,,* myContacts ::: Family,* Other,hank.googler@example.com,,,Home,(801) 555-8199,,,,,,",
    "Quinn,,Privateer,,,,,,* myContacts,* Home,quinn.privateer@example.com,,,,,,,,,,",
].join("\r\n") + "\r\n"

feature("a Google Contacts CSV: the columns mapped by the preset, a preview, and an import as personal contacts", {
    when() {
        at(8)
        return as("cbk.avery", () => {
            const parsed = call("mantle.party.ContactImportServices.parse#ContactFile", { contactFile: uploadedFile("contacts.csv", googleCsv, "text/csv") })
            const preview = call("mantle.party.ContactImportServices.preview#Contacts", { fileText: googleCsv, fileName: "contacts.csv" })
            const imported = call("mantle.party.ContactImportServices.import#Contacts", { fileText: googleCsv, fileName: "contacts.csv" })
            ginaId = imported.resultList.find((row) => row.rowNumber === 1).partyId
            const hankId = imported.resultList.find((row) => row.rowNumber === 2).partyId
            const gina = ec.entity.find("mantle.party.PartyDetail").condition("partyId", ginaId).one()
            const ginaEmails = Array.from(ec.entity.find("mantle.party.contact.PartyContactMechInfo").condition("partyId", ginaId)
                    .condition("contactMechTypeEnumId", "CmtEmailAddress").orderBy("infoString").list()).map((row) => `${row.infoString}:${row.contactMechPurposeId}`)
            const ginaPhone = ec.entity.find("mantle.party.contact.PartyContactMechTelecomNumber").condition("partyId", ginaId).one()
            const ginaAddress = ec.entity.find("mantle.party.contact.PartyContactMechPostalAddress").condition("partyId", ginaId).one()
            const ginaOrg = ec.entity.find("mantle.party.PartyRelationship").condition("fromPartyId", ginaId).condition("relationshipTypeEnumId", "PrtContact").one()
            const org = ec.entity.find("mantle.party.PartyDetail").condition("partyId", ginaOrg?.toPartyId).one()
            const listed = members(defaultBookId, { text: "googler" }).contactList
            const groups = Array.from(ec.entity.find("mantle.party.contact.ContactBookGroup").condition("contactBookId", defaultBookId)
                    .orderBy("groupName").list()).map((group) => group.groupName)
            friendsGroupId = ec.entity.find("mantle.party.contact.ContactBookGroup").condition("contactBookId", defaultBookId)
                    .condition("groupName", "Friends").one()?.contactBookGroupId
            const hank = ec.entity.find("mantle.party.Person").condition("partyId", hankId).one()
            return { parsed, preview, imported, gina, ginaEmails, ginaPhone, ginaAddress, ginaOrg, org, listed, groups, hank }
        })
    },
    then({ parsed, preview, imported, gina, ginaEmails, ginaPhone, ginaAddress, ginaOrg, org, listed, groups, hank }) {
        parsed.fileKind == "csv"
        parsed.presetId == "google"
        parsed.rowCount == 3
        parsed.columnMapping["E-mail 1 - Value"] == "email1"
        parsed.columnMapping["E-mail 1 - Label"] == "email1.label"
        parsed.columnMapping["Labels"] == "groups"
        parsed.columnMapping["Address 1 - Postal Code"] == "address1.postalCode"
        parsed.sampleRowList[0]["First Name"] == "Gina"
        parsed.sampleRowList[0]["Notes"] == "Met at the fair, 2024"
        parsed.targetFieldList.some((field) => field.fieldName === "phone1.label")
        preview.rowList.map((row) => row.action) == ["create", "create", "skip"]
        preview.rowList[2].matchedPartyId == directoryQuinnId
        preview.rowList[2].matchReason == "email"
        preview.rowList[1].problems.some((problem) => problem.includes("has no year"))
        preview.createCount == 2
        preview.skipCount == 1
        imported.contactBookId == defaultBookId
        imported.createdCount == 2
        imported.skippedCount == 1
        imported.failedCount == 0
        gina.privateOwnerUserId == averyUserId
        dayOf(gina.birthDate) == "1985-04-12"
        gina.comments == "Met at the fair, 2024"
        ginaEmails == ["gina.googler@example.com:EmailPrimary", "gina@widgets.example.com:EmailOther"]
        ginaPhone.countryCode == "1"
        ginaPhone.areaCode == "801"
        ginaPhone.contactNumber == "555-8142"
        ginaPhone.contactMechPurposeId == "PhoneMobile"
        ginaAddress.city == "Provo"
        ginaAddress.stateProvinceGeoId == "USA_UT"
        ginaAddress.countryGeoId == "USA"
        ginaAddress.contactMechPurposeId == "PostalHome"
        ginaOrg.relationshipName == "Buyer"
        org.organizationName == "Googler Widgets"
        org.privateOwnerUserId == averyUserId
        listed.length == 2
        listed.find((contact) => contact.partyId === ginaId).isFavorite == true
        listed.find((contact) => contact.partyId === ginaId).groupList.map((group) => group.groupName) == ["Friends"]
        groups == ["Family", "Friends"]
        hank.birthDate == null
    },
})

const outlookCsv = [
    "First Name,Middle Name,Last Name,Title,Suffix,E-mail Address,E-mail 2 Address,Mobile Phone,Business Phone,Company,Job Title,"
        + "Business Street,Business City,Business State,Business Postal Code,Business Country/Region,Birthday,Notes,Categories",
    "Olive,,Outlooker,Dr.,,olive.outlooker@example.com,,801-555-8177,,Contoso Labs,Engineer,1 Main St,Salt Lake City,UT,84101,"
        + "United States,5/17/1980,,Work;Friends",
    "Bad,,Row,,,not-an-email,,,,,,,,,,,,,",
    "Gina,,Googler,,,gina.googler@example.com,,,(801) 555-8123,,,,,,,,,Updated from Outlook,Friends",
].join("\r\n")

feature("an Outlook CSV: a bad row is reported and the rest imported, a match updated", {
    when() {
        at(9)
        return as("cbk.avery", () => {
            const parsed = call("mantle.party.ContactImportServices.parse#ContactFile", { fileText: outlookCsv })
            const preview = call("mantle.party.ContactImportServices.preview#Contacts", { fileText: outlookCsv, duplicatePolicy: "update" })
            const imported = call("mantle.party.ContactImportServices.import#Contacts", { fileText: outlookCsv, duplicatePolicy: "update",
                    groupNames: "Imported" })
            oliveId = imported.resultList.find((row) => row.rowNumber === 1).partyId
            const olive = ec.entity.find("mantle.party.PartyDetail").condition("partyId", oliveId).one()
            const olivePhone = ec.entity.find("mantle.party.contact.PartyContactMechTelecomNumber").condition("partyId", oliveId).one()
            const oliveAddress = ec.entity.find("mantle.party.contact.PartyContactMechPostalAddress").condition("partyId", oliveId).one()
            const ginaPhones = Array.from(ec.entity.find("mantle.party.contact.PartyContactMechTelecomNumber").condition("partyId", ginaId)
                    .orderBy("contactNumber").list()).map((tn) => `${tn.contactNumber}:${tn.contactMechPurposeId}`)
            const gina = ec.entity.find(PARTY).condition("partyId", ginaId).one()
            const badRows = ec.entity.find("mantle.party.PartyDetail").condition("firstName", "Bad").condition("lastName", "Row").count()
            const oliveGroups = members(defaultBookId, { text: "outlooker" }).contactList[0].groupList.map((group) => group.groupName).sort()
            return { parsed, preview, imported, olive, olivePhone, oliveAddress, ginaPhones, gina, badRows, oliveGroups }
        })
    },
    then({ parsed, preview, imported, olive, olivePhone, oliveAddress, ginaPhones, gina, badRows, oliveGroups }) {
        parsed.presetId == "outlook"
        parsed.columnMapping["E-mail Address"] == "email1:EmailPrimary"
        parsed.columnMapping["Business City"] == "address1.city:PostalWork"
        parsed.columnMapping["Title"] == "prefix"
        preview.rowList.map((row) => row.action) == ["create", "create", "update"]
        preview.rowList[1].problems.some((problem) => problem.includes("not-an-email"))
        preview.rowList[2].matchedPartyId == ginaId
        imported.createdCount == 1
        imported.updatedCount == 1
        imported.failedCount == 1
        imported.failureList[0].rowNumber == 2
        imported.failureList[0].values["First Name"] == "Bad"
        imported.failureList[0].error != ""
        badRows == 0
        olive.privateOwnerUserId == averyUserId
        olive.personalTitle == "Dr."
        dayOf(olive.birthDate) == "1980-05-17"
        olivePhone.contactMechPurposeId == "PhoneMobile"
        olivePhone.areaCode == "801"
        oliveAddress.contactMechPurposeId == "PostalWork"
        oliveAddress.stateProvinceGeoId == "USA_UT"
        oliveGroups == ["Friends", "Imported", "Work"]
        ginaPhones == ["555-8123:PhoneWork", "555-8142:PhoneMobile"]
        // a filled field is not overwritten
        gina.comments == "Met at the fair, 2024"
    },
})

feature("the duplicate policies on a generic CSV: skip and create", {
    when() {
        at(10)
        const csv = "Full Name,E-mail,Cell\nGina Googler,GINA.GOOGLER@example.com,\nNew Person,new.person@example.com,8015558188\n"
            + "O. Outlooker,,(801) 555-8177\nOther Person,,801.555.8177\n"
        return as("cbk.avery", () => {
            const parsed = call("mantle.party.ContactImportServices.parse#ContactFile", { fileText: csv })
            const preview = call("mantle.party.ContactImportServices.preview#Contacts", { fileText: csv })
            const skipped = call("mantle.party.ContactImportServices.import#Contacts", { fileText: csv, duplicatePolicy: "skip" })
            at(11)
            const created = call("mantle.party.ContactImportServices.import#Contacts", { fileText: csv, duplicatePolicy: "create" })
            const ginas = ec.entity.find("mantle.party.PartyDetail").condition("firstName", "Gina").condition("lastName", "Googler")
                    .condition("privateOwnerUserId", averyUserId).count()
            return { parsed, preview, skipped, created, ginas }
        })
    },
    then({ parsed, preview, skipped, created, ginas }) {
        parsed.presetId == "generic"
        preview.rowList.map((row) => `${row.action}:${row.matchReason}`) == ["skip:email", "create:null", "skip:phone", "create:null"]
        preview.rowList[2].matchedPartyId == oliveId
        parsed.columnMapping["Full Name"] == "fullName"
        parsed.columnMapping["E-mail"] == "email1"
        parsed.columnMapping["Cell"] == "phone2:PhoneMobile"
        skipped.skippedCount == 2
        skipped.createdCount == 2
        skipped.resultList[0].matchedPartyId == ginaId
        skipped.resultList[2].matchedPartyId == oliveId
        created.createdCount == 4
        created.skippedCount == 0
        ginas == 2
    },
})

// a contact file's bytes in a character set: Windows-1252 (as Outlook writes), UTF-16 with either byte order mark, UTF-16
// chosen for a file without one (little-endian, as Windows writes), and UTF-8 with its byte order mark
const charsetText = "Full Name,E-mail\r\nZoë “Zed” Ångström,zoe.charset@example.com\r\n"
const cp1252Bytes = (text) => Array.from(text).map((ch) => ({ "“": 0x93, "”": 0x94, "€": 0x80, "–": 0x96 })[ch] ?? ch.charCodeAt(0))
const utf16Bytes = (text, little) => Array.from(text).flatMap((ch) => {
    const code = ch.charCodeAt(0)
    return little ? [code & 0xFF, code >> 8] : [code >> 8, code & 0xFF]
})
const utf8Bytes = (text) => Array.from(unescape(encodeURIComponent(text))).map((ch) => ch.charCodeAt(0))

feature("a contact file in its character set: Windows-1252, UTF-16 by its byte order mark whatever was chosen, UTF-16 without one little-endian", {
    when() {
        const files = { cp1252: [cp1252Bytes(charsetText), "WINDOWS-1252"], utf16le: [[0xFF, 0xFE].concat(utf16Bytes(charsetText, true)), "UTF-8"],
            utf16be: [[0xFE, 0xFF].concat(utf16Bytes(charsetText, false)), "WINDOWS-1252"], utf16plain: [utf16Bytes(charsetText, true), "UTF-16"],
            utf8bom: [[0xEF, 0xBB, 0xBF].concat(utf8Bytes(charsetText)), "UTF-8"] }
        const out = {}
        for (const [name, [bytes, characterSet]] of Object.entries(files)) {
            const fileLocation = `dbresource://mantle-usl-test/ContactBooks/${name}.csv`
            ec.resource.getLocationReference(fileLocation).putBytes(new Uint8Array(bytes))
            const read = call("mantle.party.ContactImportServices.read#ContactFileText", { fileLocation, characterSet })
            const parsed = call("mantle.party.ContactImportServices.parse#ContactFile", { fileLocation, fileName: `${name}.csv`, characterSet })
            out[name] = { text: read.text, used: read.characterSetUsed, name: parsed.sampleRowList[0]["Full Name"], rowCount: parsed.rowCount }
        }
        out.missing = call("mantle.party.ContactImportServices.read#ContactFileText", { fileLocation: "dbresource://mantle-usl-test/ContactBooks/none.csv" })
        out.upload = call("mantle.party.ContactImportServices.read#ContactFileText", { contactFile: uploadedFile("upload.csv", charsetText, "text/csv") })
        return out
    },
    then({ cp1252, utf16le, utf16be, utf16plain, utf8bom, missing, upload }) {
        cp1252.text == charsetText
        cp1252.used == "WINDOWS-1252"
        cp1252.name == "Zoë “Zed” Ångström"
        cp1252.rowCount == 1
        utf16le.text == charsetText
        utf16le.used == "UTF-16"
        utf16le.name == "Zoë “Zed” Ångström"
        utf16be.text == charsetText
        utf16be.used == "UTF-16"
        utf16plain.text == charsetText
        utf16plain.used == "UTF-16LE"
        utf8bom.text == charsetText
        utf8bom.name == "Zoë “Zed” Ångström"
        missing.text == null
        upload.text == charsetText
        upload.characterSetUsed == "UTF-8"
    },
})

// a vCard 3.0 card with TYPE parameters, a PREF type and a folded NOTE; a 4.0 card with PREF values and Apple's item
// labels (a standard one and a custom one); and a 4.0 card of a contact already there (Olive, by email)
const vcf = [
    "BEGIN:VCARD", "VERSION:3.0", "N:Cardholder;Vera;Q.;Ms.;", "FN:Ms. Vera Q. Cardholder", "ORG:Cardholder Studio;Design", "TITLE:Art Director",
    "EMAIL;TYPE=INTERNET,WORK:vera@cardholder-studio.example.com", "EMAIL;TYPE=INTERNET,HOME,PREF:vera.cardholder@example.com",
    "TEL;TYPE=CELL,VOICE:+1 801 555 8201", "TEL;TYPE=WORK,FAX:(801) 555-8202", "ADR;TYPE=HOME:;;42 Juniper Lane;Ogden;UT;84401;United States",
    "BDAY:1990-02-03", "NOTE:Met at the print expo\\, prefers email over phone calls on weekday", " s and evenings",
    "CATEGORIES:Clients,Designers", "END:VCARD",
    "BEGIN:VCARD", "VERSION:4.0", "UID:urn:uuid:5f0c2b1e-8d3a-4e6f-9b7c-1a2d3e4f5a6b", "FN:Wade Cardholder", "N:Cardholder;Wade;;;",
    "EMAIL;TYPE=work;PREF=2:wade@cardholder-studio.example.com", "EMAIL;TYPE=home;PREF=1:wade.cardholder@example.com",
    "item1.TEL:+1-801-555-8203", "item1.X-ABLabel:_$!<Mobile>!$_", "item2.TEL;VALUE=uri:tel:+1-801-555-8204", "item2.X-ABLabel:Studio",
    "item3.ADR:;;9 Canyon Rd;Park City;UT;84060;USA", "item3.X-ABLabel:_$!<Work>!$_", "CATEGORIES:Designers", "END:VCARD",
    "BEGIN:VCARD", "VERSION:4.0", "FN:Olive Outlooker", "N:Outlooker;Olive;;;", "EMAIL;PREF=1:olive.outlooker@example.com",
    "EMAIL;TYPE=work:olive@contoso-labs.example.com", "END:VCARD",
].join("\r\n") + "\r\n"
let cardsBookId

feature("a vCard file: 3.0 and 4.0 cards previewed and imported into a book as personal contacts, a known one updated, and the book's vCard export reads back", {
    when() {
        at(11.5)
        return as("cbk.avery", () => {
            cardsBookId = call("mantle.party.ContactBookServices.create#ContactBook", { contactBookName: "Cards" }).contactBookId
            // as an upload, as a screen sends it (the Apple labels have a < that a text parameter refuses)
            const file = () => uploadedFile("cards.vcf", vcf, "text/vcard")
            const parsed = call("mantle.party.ContactImportServices.parse#ContactFile", { contactFile: file() })
            const preview = call("mantle.party.ContactImportServices.preview#Contacts", { contactFile: file(), duplicatePolicy: "update" })
            const imported = call("mantle.party.ContactImportServices.import#Contacts", { contactFile: file(), contactBookId: cardsBookId,
                    duplicatePolicy: "update" })
            const idOf = (rowNumber) => imported.resultList.find((row) => row.rowNumber === rowNumber).partyId
            const [veraId, wadeId] = [idOf(1), idOf(2)]
            const person = (partyId) => ec.entity.find("mantle.party.PartyDetail").condition("partyId", partyId).one()
            const emails = (partyId) => Array.from(ec.entity.find("mantle.party.contact.PartyContactMechInfo").condition("partyId", partyId)
                    .condition("contactMechTypeEnumId", "CmtEmailAddress").list()).map((row) => `${row.infoString}:${row.contactMechPurposeId}`).sort()
            const phones = (partyId) => Array.from(ec.entity.find("mantle.party.contact.PartyContactMechTelecomNumber").condition("partyId", partyId)
                    .list()).map((tn) => `${tn.countryCode}-${tn.areaCode}-${tn.contactNumber}:${tn.contactMechPurposeId}`).sort()
            const address = (partyId) => ec.entity.find("mantle.party.contact.PartyContactMechPostalAddress").condition("partyId", partyId).one()
            const veraOrg = ec.entity.find("mantle.party.PartyRelationship").condition("fromPartyId", veraId).condition("relationshipTypeEnumId", "PrtContact").one()
            const listed = members(cardsBookId).contactList
            const groups = Array.from(ec.entity.find("mantle.party.contact.ContactBookGroup").condition("contactBookId", cardsBookId)
                    .orderBy("groupName").list()).map((group) => group.groupName)
            const result = { parsed, preview, imported, veraId, wadeId, vera: person(veraId), wade: person(wadeId), veraEmails: emails(veraId),
                wadeEmails: emails(wadeId), oliveEmails: emails(oliveId), veraPhones: phones(veraId), wadePhones: phones(wadeId),
                veraAddress: address(veraId), wadeAddress: address(wadeId), veraOrg, veraOrgName: person(veraOrg?.toPartyId)?.organizationName,
                listed, groups }
            // the book as vCard 4.0, read back by the tool, and an import preview of it finds every contact again
            result.exported = call("mantle.party.ContactImportServices.export#Contacts", { contactBookId: cardsBookId, format: "vcard" })
            result.cards = Array.from(ec.factory.getTool("VCard").parse(result.exported.fileText))
            result.again = call("mantle.party.ContactImportServices.preview#Contacts", { contactFile: uploadedFile("Cards.vcf", result.exported.fileText,
                    "text/vcard") })
            return result
        })
    },
    then({ parsed, preview, imported, veraId, wadeId, vera, wade, veraEmails, wadeEmails, oliveEmails, veraPhones, wadePhones, veraAddress,
            wadeAddress, veraOrg, veraOrgName, listed, groups, exported, cards, again }) {
        parsed.fileKind == "vcard"
        parsed.presetId == "vcard"
        parsed.rowCount == 3
        parsed.columnMapping["email1.label"] == "email1.label"
        parsed.columnMapping["address1.city"] == "address1.city"
        parsed.sampleRowList[0]["email2.label"] == "* Home"
        parsed.sampleRowList[1]["phone1.label"] == "Mobile"
        parsed.sampleRowList[1]["phone2.label"] == "Studio"
        preview.rowList.map((row) => `${row.action}:${row.matchReason}`) == ["create:null", "create:null", "update:email"]
        preview.rowList[2].matchedPartyId == oliveId
        imported.contactBookId == cardsBookId
        imported.createdCount == 2
        imported.updatedCount == 1
        imported.failedCount == 0
        imported.resultList[2].partyId == oliveId
        // names, with the folded NOTE joined
        ;[vera.firstName, vera.middleName, vera.lastName, vera.personalTitle] == ["Vera", "Q.", "Cardholder", "Ms."]
        vera.privateOwnerUserId == averyUserId
        dayOf(vera.birthDate) == "1990-02-03"
        vera.comments == "Met at the print expo, prefers email over phone calls on weekdays and evenings"
        ;[wade.firstName, wade.lastName, wade.privateOwnerUserId] == ["Wade", "Cardholder", averyUserId]
        // the preferred email is the primary one: TYPE=PREF in 3.0, PREF=1 in 4.0
        veraEmails == ["vera.cardholder@example.com:EmailPrimary", "vera@cardholder-studio.example.com:EmailOther"]
        wadeEmails == ["wade.cardholder@example.com:EmailPrimary", "wade@cardholder-studio.example.com:EmailOther"]
        // the duplicate policy update adds Olive's new work address
        oliveEmails == ["olive.outlooker@example.com:EmailPrimary", "olive@contoso-labs.example.com:EmailOther"]
        veraPhones == ["1-801-555-8201:PhoneMobile", "1-801-555-8202:PhoneFax"]
        // Apple's _$!<Mobile>!$_ is Mobile; its custom label Studio is another phone
        wadePhones == ["1-801-555-8203:PhoneMobile", "1-801-555-8204:Other"]
        veraAddress.address1 == "42 Juniper Lane"
        veraAddress.city == "Ogden"
        veraAddress.postalCode == "84401"
        veraAddress.stateProvinceGeoId == "USA_UT"
        veraAddress.countryGeoId == "USA"
        veraAddress.contactMechPurposeId == "PostalHome"
        wadeAddress.city == "Park City"
        wadeAddress.contactMechPurposeId == "PostalWork"
        veraOrgName == "Cardholder Studio"
        veraOrg.relationshipName == "Art Director, Design"
        // the cards' CATEGORIES are groups of the book
        groups == ["Clients", "Designers"]
        listed.length == 3
        listed.find((contact) => contact.partyId === veraId).groupList.map((group) => group.groupName).sort() == ["Clients", "Designers"]
        listed.find((contact) => contact.partyId === wadeId).groupList.map((group) => group.groupName) == ["Designers"]
        listed.find((contact) => contact.partyId === oliveId).groupList.length == 0
        exported.contentType == "text/vcard"
        exported.fileName == "Cards.vcf"
        exported.exportedCount == 3
        exported.fileText.startsWith("BEGIN:VCARD\r\nVERSION:4.0\r\n")
        cards.length == 3
        cards.find((card) => card.firstName === "Vera").lastName == "Cardholder"
        cards.find((card) => card.firstName === "Vera").email1 == "vera.cardholder@example.com"
        cards.find((card) => card.firstName === "Vera").email2 == "vera@cardholder-studio.example.com"
        cards.find((card) => card.firstName === "Vera")["address1.city"] == "Ogden"
        cards.find((card) => card.firstName === "Vera").birthday == "1990-02-03"
        cards.find((card) => card.firstName === "Vera").notes == "Met at the print expo, prefers email over phone calls on weekdays and evenings"
        cards.find((card) => card.firstName === "Vera").groups.split(", ").sort() == ["Clients", "Designers"]
        cards.find((card) => card.firstName === "Wade").email1 == "wade.cardholder@example.com"
        again.rowList.map((row) => `${row.action}:${row.matchReason}`) == ["skip:email", "skip:email", "skip:email"]
        again.rowList.map((row) => row.matchedPartyId).sort() == [veraId, wadeId, oliveId].sort()
    },
})

feature("export a book as Google Contacts CSV and as vCard 4.0; another user cannot", {
    when() {
        return as("cbk.avery", () => {
            const csv = call("mantle.party.ContactImportServices.export#Contacts", { contactBookId: defaultBookId })
            const friends = call("mantle.party.ContactImportServices.export#Contacts", { contactBookId: defaultBookId, contactBookGroupId: friendsGroupId })
            const vcard = call("mantle.party.ContactImportServices.export#Contacts", { partyIdList: [ginaId], format: "vcard" })
            const blake = as("cbk.blake", () => errorOf("mantle.party.ContactImportServices.export#Contacts", { contactBookId: defaultBookId }))
            const blakeParties = as("cbk.blake", () => call("mantle.party.ContactImportServices.export#Contacts", { partyIdList: [ginaId] }).exportedCount)
            // the export reads back with the Google preset
            const reread = call("mantle.party.ContactImportServices.parse#ContactFile", { fileText: csv.fileText, sampleSize: 50 })
            return { csv, friends, vcard, blake, blakeParties, reread }
        })
    },
    then({ csv, friends, vcard, blake, blakeParties, reread }) {
        csv.contentType == "text/csv"
        csv.fileName == "My-Contacts.csv"
        csv.fileText.startsWith("First Name,Middle Name,Last Name,Name Prefix,Name Suffix,Nickname,Organization Name,Organization Title,Birthday,Notes,Labels,E-mail 1 - Label,E-mail 1 - Value")
        csv.fileText.includes("gina.googler@example.com")
        csv.fileText.includes("* myContacts ::: * starred ::: Friends")
        csv.fileText.includes("\"Met at the fair, 2024\"")
        csv.exportedCount >= 5
        friends.exportedCount == 2
        reread.presetId == "google"
        reread.rowCount == csv.exportedCount
        vcard.contentType == "text/vcard"
        vcard.exportedCount == 1
        vcard.fileText.startsWith("BEGIN:VCARD\r\nVERSION:4.0\r\n")
        vcard.fileText.includes("FN:Gina Googler")
        vcard.fileText.includes("N:Googler;Gina;;;")
        vcard.fileText.includes("EMAIL;TYPE=home;PREF=1:gina.googler@example.com")
        vcard.fileText.includes("BDAY:19850412")
        vcard.fileText.includes("NOTE:Met at the fair\\, 2024")
        vcard.fileText.includes("ORG:Googler Widgets")
        blake.includes("not found")
        blakeParties == 0
    },
})

feature("deleting a personal book moves its only-here personal contacts to the default book", {
    when() {
        at(12)
        return as("cbk.avery", () => {
            const out = call("mantle.party.ContactBookServices.delete#ContactBook", { contactBookId: familyBookId })
            return { out, book: ec.entity.find("mantle.party.contact.ContactBook").condition("contactBookId", familyBookId).one(),
                inDefault: currentCount("mantle.party.contact.ContactBookParty", { contactBookId: defaultBookId, partyId: grandmaId }),
                rows: countOf("mantle.party.contact.ContactBookParty", { contactBookId: familyBookId }) }
        })
    },
    then({ out, book, inDefault, rows }) {
        out.movedPartyIdList == [grandmaId]
        book == null
        inDefault == 1
        rows == 0
    },
})

feature("merge#Parties moves the work, request, message, list, book and link rows, keeping the to party's on a key collision", {
    when() {
        at(13)
        const toId = call("mantle.party.PartyServices.create#Person", { firstName: "Mergeto", lastName: "Bookkeeper" }).partyId
        const fromId = call("mantle.party.PartyServices.create#Person", { firstName: "Mergefrom", lastName: "Bookkeeper" }).partyId
        const now = ec.user.nowTimestamp
        call("mantle.work.TaskServices.create#Task", { workEffortId: "CBK-T1", workEffortName: "Merge task", assignToPartyId: fromId })
        call("create#mantle.request.Request", { requestId: "CBK-R1", requestName: "Merge request", requestTypeEnumId: "RqtSupport", statusId: "ReqSubmitted", requestDate: now })
        call("create#mantle.request.RequestParty", { requestId: "CBK-R1", partyId: fromId, roleTypeId: "Reporter", fromDate: now })
        call("create#mantle.party.communication.CommunicationEvent", { communicationEventId: "CBK-C1", communicationEventTypeId: "Message",
                statusId: "CeSent", fromPartyId: "EX_JOHN_DOE", toPartyId: "ORG_ZIZI_RETAIL", subject: "Merge message", entryDate: now })
        // the same message row on both parties: the to party's stays
        call("create#mantle.party.communication.CommunicationEventParty", { communicationEventId: "CBK-C1", partyId: fromId, roleTypeId: "Watcher", statusId: "CepClosed" })
        call("create#mantle.party.communication.CommunicationEventParty", { communicationEventId: "CBK-C1", partyId: toId, roleTypeId: "Watcher" })
        call("create#mantle.marketing.contact.ContactList", { contactListId: "CBK_LIST", contactListName: "Merge list" })
        call("create#mantle.marketing.contact.ContactListParty", { contactListId: "CBK_LIST", partyId: fromId, fromDate: now })
        // both in the team book (the from party a favorite), only the from party in its group
        call("create#mantle.party.contact.ContactBookParty", { contactBookId: teamBookId, partyId: toId, fromDate: now })
        call("create#mantle.party.contact.ContactBookParty", { contactBookId: teamBookId, partyId: fromId, fromDate: now, isFavorite: "Y" })
        const groupId = call("create#mantle.party.contact.ContactBookGroup", { contactBookId: teamBookId, groupName: "Merge group" }).contactBookGroupId
        call("create#mantle.party.contact.ContactBookGroupParty", { contactBookGroupId: groupId, partyId: fromId, fromDate: now })
        // the generic links and a follower of the from party's record
        call("create#mantle.party.communication.CommunicationEventRecord", { communicationEventId: "CBK-C1", recordEntityName: PARTY, recordId: fromId })
        call("create#mantle.work.effort.WorkEffortRecord", { workEffortId: "CBK-T1", recordEntityName: PARTY, recordId: fromId })
        call("create#mantle.party.communication.RecordFollower", { recordEntityName: PARTY, recordId: fromId, userId: averyUserId })
        call("create#mantle.party.communication.RecordFollower", { recordEntityName: PARTY, recordId: toId, userId: averyUserId, notifyChanges: "Y" })

        call("mantle.party.DuplicateServices.merge#Parties", { toPartyId: toId, fromPartyId: fromId })
        const left = {}
        for (const [entityName, fields] of [["mantle.work.effort.WorkEffortParty", { partyId: fromId }], ["mantle.request.RequestParty", { partyId: fromId }],
            ["mantle.party.communication.CommunicationEventParty", { partyId: fromId }], ["mantle.marketing.contact.ContactListParty", { partyId: fromId }],
            ["mantle.party.contact.ContactBookParty", { partyId: fromId }], ["mantle.party.contact.ContactBookGroupParty", { partyId: fromId }],
            ["mantle.party.communication.CommunicationEventRecord", { recordEntityName: PARTY, recordId: fromId }],
            ["mantle.work.effort.WorkEffortRecord", { recordEntityName: PARTY, recordId: fromId }],
            ["mantle.party.communication.RecordFollower", { recordEntityName: PARTY, recordId: fromId }]]) {
            left[entityName.substring(entityName.lastIndexOf(".") + 1)] = countOf(entityName, fields)
        }
        const moved = {
            work: countOf("mantle.work.effort.WorkEffortParty", { workEffortId: "CBK-T1", partyId: toId }),
            request: countOf("mantle.request.RequestParty", { requestId: "CBK-R1", partyId: toId }),
            message: Array.from(ec.entity.find("mantle.party.communication.CommunicationEventParty").condition("communicationEventId", "CBK-C1")
                    .condition("partyId", toId).list()).map((row) => row.statusId ?? null),
            list: countOf("mantle.marketing.contact.ContactListParty", { contactListId: "CBK_LIST", partyId: toId }),
            book: Array.from(ec.entity.find("mantle.party.contact.ContactBookParty").condition("contactBookId", teamBookId)
                    .condition("partyId", toId).list()).map((row) => row.isFavorite ?? null),
            group: countOf("mantle.party.contact.ContactBookGroupParty", { contactBookGroupId: groupId, partyId: toId }),
            commRecord: countOf("mantle.party.communication.CommunicationEventRecord", { recordEntityName: PARTY, recordId: toId }),
            workRecord: countOf("mantle.work.effort.WorkEffortRecord", { recordEntityName: PARTY, recordId: toId }),
            follower: Array.from(ec.entity.find("mantle.party.communication.RecordFollower").condition("recordEntityName", PARTY)
                    .condition("recordId", toId).list()).map((row) => row.notifyChanges),
        }
        return { left, moved }
    },
    then({ left, moved }) {
        left == { WorkEffortParty: 0, RequestParty: 0, CommunicationEventParty: 0, ContactListParty: 0, ContactBookParty: 0,
            ContactBookGroupParty: 0, CommunicationEventRecord: 0, WorkEffortRecord: 0, RecordFollower: 0 }
        moved.work == 1
        moved.request == 1
        moved.message == [null]
        moved.list == 1
        moved.book == ["Y"]
        moved.group == 1
        moved.commRecord == 1
        moved.workRecord == 1
        moved.follower == ["Y"]
    },
})
