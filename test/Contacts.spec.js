// Contacts in the directory and personal contacts, the follow-ups of the IronStone contacts screens: find#Party with one
// text across names, emails, phones and organizations (phones by their digits) and hasRole, with exact counts; the name
// reason of the duplicate scan (find#PartyNameMatches, a score per pair); the "not a duplicate" decision
// (mark#PartyNotDuplicate, unmark#PartyNotDuplicate) that find#PartyDuplicates, find#PartyHasDuplicates, the scan and
// merge#Parties honour; deleting a contact (delete#Contact, delete#Contacts: removed when nothing refers to it, else
// disabled); and match#Contact's plain matched name. Personal contacts (Party.privateOwnerUserId) stay their owner's on
// every one of these paths. New spec, no Groovy original.
const effectiveTime = Date.now()
const dayMillis = 86400000
const minute = 60000
// each step at its own minute, so date-keyed rows (book members, contact mechanisms) do not collide
const at = (minutes) => ec.user.setEffectiveTime(effectiveTime + minutes * minute)
const PARTY = "mantle.party.Party"
let erinUserId, erinPartyId
let wrexlowOrgId, odessaId, bramId, inesId, erinWrexlowId, erinMarloweId, quillOrgId, piaId
let zephA, zephB, zephC, zephD, zoraE, erinZephF, orgWidgetsInc, orgWidgetsLlc, orgGadgets
let halcyon1, halcyon2, halcyon3

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
// run as the spec's user (authz stays disabled, so only the services' own conditions apply)
function as(username, run) {
    login(username, "moqui1!!")
    try { return run() } finally { login("john.doe") }
}
const find = (params) => call("mantle.party.PartyServices.find#Party", Object.assign({ pageSize: 50 }, params))
const ids = (params) => find(params).partyIdList.slice().sort()
const sorted = (list) => list.slice().sort()
const person = (firstName, lastName, extra) => call("mantle.party.PartyServices.create#Person", Object.assign({ firstName, lastName }, extra || {})).partyId
const nameMatches = (params) => call("mantle.party.DuplicateServices.find#PartyNameMatches", params).matchList
const duplicatesOf = (partyId) => call("mantle.party.DuplicateServices.find#PartyDuplicates", { partyId }).matchingInfoByPartyId
const partyOf = (partyId) => ec.entity.find(PARTY).condition("partyId", partyId).one()
const countOf = (entityName, fields) => ec.entity.find(entityName).condition(fields).count()
const currentCount = (entityName, fields) => ec.entity.find(entityName).condition(fields)
        .condition(ec.entity.conditionFactory.makeConditionDate("fromDate", "thruDate", null)).count()

feature("a user without the contact admin permission, and directory parties with names, emails, phones and an organization", {
    when() {
        erinPartyId = person("Erin", "Contacter")
        erinUserId = call("mantle.party.PartyServices.create#PartyUserAccount", { partyId: erinPartyId, emailAddress: "ctc.erin@example.com",
                username: "ctc.erin", newPassword: "moqui1!!", newPasswordVerify: "moqui1!!" }).userId
        wrexlowOrgId = call("mantle.party.PartyServices.create#Organization", { organizationName: "Wrexlow Instruments", roleTypeId: "Customer" }).partyId
        odessaId = person("Odessa", "Wrexlow", { roleTypeId: "Customer" })
        call("mantle.party.ContactServices.create#EmailAddress", { partyId: odessaId, emailAddress: "odessa@wrexlow-mail.example", contactMechPurposeId: "EmailPrimary" })
        call("mantle.party.ContactServices.create#TelecomNumber", { partyId: odessaId, countryCode: "1", areaCode: "417", contactNumber: "863-2951",
                contactMechPurposeId: "PhonePrimary" })
        // Bram is a contact of Wrexlow Instruments; Ines has a number without area or country code, and no role
        bramId = person("Bram", "Halvorsen", { roleTypeId: "Supplier" })
        call("create#mantle.party.PartyRelationship", { relationshipTypeEnumId: "PrtContact", fromPartyId: bramId, toPartyId: wrexlowOrgId,
                fromDate: effectiveTime - dayMillis, relationshipName: "Buyer" })
        inesId = person("Ines", "Marlowe")
        call("mantle.party.ContactServices.create#TelecomNumber", { partyId: inesId, contactNumber: "4178632978", contactMechPurposeId: "PhoneMobile" })
        const ctcAdmin = { john: ec.user.hasPermission("CONTACT_ADMIN"), erin: as("ctc.erin", () => ec.user.hasPermission("CONTACT_ADMIN")) }
        return { ctcAdmin }
    },
    then({ ctcAdmin }) {
        erinUserId != null
        ctcAdmin == { john: true, erin: false }
    },
})

feature("Erin's personal contacts: one with Odessa's email and phone, one with no role, and a person of a personal organization linked to the directory", {
    when() {
        at(1)
        as("ctc.erin", () => {
            erinWrexlowId = call("mantle.party.ContactBookServices.create#PersonalContact", { firstName: "Wren", lastName: "Wrexlow",
                    emailAddress: "odessa@wrexlow-mail.example", countryCode: "1", areaCode: "417", contactNumber: "863-2951" }).partyId
            erinMarloweId = call("mantle.party.ContactBookServices.create#PersonalContact", { firstName: "Tobin", lastName: "Marlowe" }).partyId
            // a person of an organization Erin's contact data made (personal, as the person was), then the person shared
            piaId = call("mantle.party.ContactBookServices.store#ContactParty", { contact: { firstName: "Pia", lastName: "Linden",
                    organizationName: "Quillfeather Labs", jobTitle: "Founder" }, privateOwnerUserId: erinUserId }).partyId
            call("mantle.party.ContactBookServices.link#PersonalContactToDirectory", { partyId: piaId, roleTypeId: "Customer" })
        })
        quillOrgId = ec.entity.find("mantle.party.PartyRelationship").condition("fromPartyId", piaId).one().toPartyId
        return { pia: partyOf(piaId), quill: partyOf(quillOrgId) }
    },
    then({ pia, quill }) {
        pia.privateOwnerUserId == null
        quill.privateOwnerUserId == erinUserId
    },
})

feature("anyField finds by name in either order, by email, and the people of an organization, with an exact count across the page", {
    when() {
        return {
            byWord: ids({ anyField: "Wrexlow" }),
            page: find({ anyField: "Wrexlow", pageSize: 2 }),
            fullName: ids({ anyField: "Odessa Wrexlow" }),
            reversed: ids({ anyField: "Wrexlow, Odessa" }),
            email: ids({ anyField: "odessa@wrexlow" }),
            emailContains: ids({ anyField: "wrexlow-mail.example", leadingWildcard: true }),
            organization: ids({ anyField: "Wrexlow Instruments" }),
            narrowed: ids({ anyField: "Wrexlow", partyTypeEnumId: "PtyPerson" }),
            combined: ids({ combinedName: "Wrexlow" }),
            erin: as("ctc.erin", () => ids({ anyField: "Wrexlow" })),
            erinEmail: as("ctc.erin", () => ids({ anyField: "odessa@wrexlow" })),
        }
    },
    then({ byWord, page, fullName, reversed, email, emailContains, organization, narrowed, combined, erin, erinEmail }) {
        byWord == sorted([wrexlowOrgId, odessaId, bramId])
        page.partyIdList.length == 2
        page.partyIdListCount == 3
        page.partyIdListPageMaxIndex == 1
        fullName == [odessaId]
        reversed == [odessaId]
        email == [odessaId]
        emailContains == [odessaId]
        organization == sorted([wrexlowOrgId, bramId])
        narrowed == sorted([odessaId, bramId])
        // the existing parameters are as they were
        combined == sorted([wrexlowOrgId, odessaId])
        // Erin's personal contact is hers alone
        erin == sorted([wrexlowOrgId, odessaId, bramId, erinWrexlowId])
        erinEmail == sorted([odessaId, erinWrexlowId])
    },
})

feature("anyField finds a phone by its digits whatever the formatting, with or without a country code, and only the user's own personal contact", {
    when() {
        return {
            international: ids({ anyField: "+1 (417) 863-2951" }),
            dotted: ids({ anyField: "417.863.2951" }),
            local: ids({ anyField: "8632951" }),
            partial: ids({ anyField: "863-29" }),
            inesWithCountry: ids({ anyField: "+1 417 863 2978" }),
            inesPlain: ids({ anyField: "(417) 863-2978" }),
            other: ids({ anyField: "417 863 2999" }),
            erin: as("ctc.erin", () => ids({ anyField: "417-863-2951" })),
            count: find({ anyField: "863-29" }).partyIdListCount,
        }
    },
    then({ international, dotted, local, partial, inesWithCountry, inesPlain, other, erin, count }) {
        international == [odessaId]
        dotted == [odessaId]
        local == [odessaId]
        partial == sorted([odessaId, inesId])
        count == 2
        inesWithCountry == [inesId]
        inesPlain == [inesId]
        other.length == 0
        erin == sorted([odessaId, erinWrexlowId])
    },
})

feature("hasRole leaves out directory parties with no role, keeps the user's personal contacts unless excluded; an organization's people only when the user may see it", {
    when() {
        return {
            all: ids({ anyField: "Marlowe" }),
            withRole: ids({ anyField: "Marlowe", hasRole: true }),
            erinAll: as("ctc.erin", () => ids({ anyField: "Marlowe" })),
            erinWithRole: as("ctc.erin", () => ids({ anyField: "Marlowe", hasRole: true })),
            erinDirectoryWithRole: as("ctc.erin", () => ids({ anyField: "Marlowe", hasRole: true, personalContacts: "exclude" })),
            roleCount: find({ anyField: "Wrexlow", hasRole: true }).partyIdListCount,
            // Pia is in the directory now, her organization is still Erin's personal one
            quill: ids({ anyField: "Quillfeather" }),
            erinQuill: as("ctc.erin", () => ids({ anyField: "Quillfeather" })),
            linden: ids({ anyField: "Linden" }),
        }
    },
    then({ all, withRole, erinAll, erinWithRole, erinDirectoryWithRole, roleCount, quill, erinQuill, linden }) {
        all == [inesId]
        withRole.length == 0
        erinAll == sorted([inesId, erinMarloweId])
        erinWithRole == [erinMarloweId]
        erinDirectoryWithRole.length == 0
        roleCount == 3
        quill.length == 0
        erinQuill == sorted([quillOrgId, piaId])
        linden == [piaId]
    },
})

feature("similar names: a person by last name and first name, initial or start, an organization without its legal suffix; never a personal contact", {
    when() {
        at(2)
        zephA = person("Zephyrine", "Quorvane", { roleTypeId: "Customer" })
        zephB = person("Zephyrine", "Quorvaine")
        zephC = person("Z.", "Quorvane")
        zephD = person("Zeph", "QUORVANE")
        zoraE = person("Zora", "Quorvane")
        erinZephF = as("ctc.erin", () => call("mantle.party.ContactBookServices.create#PersonalContact", { firstName: "Zephyrine", lastName: "Quorvane" }).partyId)
        orgWidgetsInc = call("mantle.party.PartyServices.create#Organization", { organizationName: "Quorvane Widgets Inc." }).partyId
        orgWidgetsLlc = call("mantle.party.PartyServices.create#Organization", { organizationName: "The Quorvane Widgets, LLC" }).partyId
        orgGadgets = call("mantle.party.PartyServices.create#Organization", { organizationName: "Quorvane Gadgets" }).partyId
        const ofA = nameMatches({ partyId: zephA })
        const byNames = nameMatches({ firstName: "Zephyrine", lastName: "Quorvane" })
        return {
            ofA, byNames,
            ofE: nameMatches({ partyId: zoraE }).map((match) => match.partyId),
            ofInc: nameMatches({ partyId: orgWidgetsInc }),
            byOrgName: nameMatches({ organizationName: "quorvane widgets" }).map((match) => match.partyId),
            strict: nameMatches({ partyId: zephA, minScore: 98 }).map((match) => match.partyId),
            personal: as("ctc.erin", () => nameMatches({ partyId: erinZephF })),
            dups: duplicatesOf(zephA),
            has: call("mantle.party.DuplicateServices.find#PartyHasDuplicates", { partyId: zephD }).hasDuplicates,
            gadgetsHas: call("mantle.party.DuplicateServices.find#PartyHasDuplicates", { partyId: orgGadgets }).hasDuplicates,
        }
    },
    then({ ofA, byNames, ofE, ofInc, byOrgName, strict, personal, dups, has, gadgetsHas }) {
        sorted(ofA.map((match) => match.partyId)) == sorted([zephB, zephC, zephD])
        // the start of the first name and an initial each count 0.9 with the same last name
        ofA.find((match) => match.partyId === zephC).score == 96
        ofA.find((match) => match.partyId === zephD).score == 96
        ofA.find((match) => match.partyId === zephB).score == 99
        ofA.find((match) => match.partyId === zephB).name == "Zephyrine Quorvaine"
        ofA[0].partyId == zephB
        // without a party: by names, and Erin's personal contact is never one
        sorted(byNames.map((match) => match.partyId)) == sorted([zephA, zephB, zephC, zephD])
        byNames.find((match) => match.partyId === zephA).score == 100
        // Zora matches only the initial
        ofE == [zephC]
        ofInc.map((match) => `${match.partyId}:${match.score}`) == [`${orgWidgetsLlc}:100`]
        sorted(byOrgName) == sorted([orgWidgetsInc, orgWidgetsLlc])
        strict == [zephB]
        personal.length == 0
        dups[zephB].map((info) => info.matchType) == ["name"]
        dups[zephB][0].nameScore == 99
        !Object.keys(dups).includes(erinZephF)
        !Object.keys(dups).includes(zoraE)
        has == true
        gadgetsHas == false
    },
})

feature("not a duplicate: one row for the pair either way round, left out of the duplicates, the flags and the scan", {
    when() {
        at(3)
        halcyon1 = person("Halcyon", "Brightwater", { roleTypeId: "Customer" })
        halcyon2 = person("Halcyon", "Brightwater", { roleTypeId: "Customer" })
        for (const partyId of [halcyon1, halcyon2])
            call("mantle.party.ContactServices.create#EmailAddress", { partyId, emailAddress: "halcyon@brightwater.example", contactMechPurposeId: "EmailPrimary" })
        const before = duplicatesOf(halcyon1)
        call("mantle.party.DuplicateServices.mark#PartyNotDuplicate", { partyId: halcyon2, otherPartyId: halcyon1, comments: "Twins" })
        const [lowId, highId] = halcyon1 < halcyon2 ? [halcyon1, halcyon2] : [halcyon2, halcyon1]
        const row = ec.entity.find("mantle.party.PartyNotDuplicate").condition({ partyId: lowId, otherPartyId: highId }).one()
        const rows = countOf("mantle.party.PartyNotDuplicate", { partyId: highId })
        const after = duplicatesOf(halcyon1)
        const has = call("mantle.party.DuplicateServices.find#PartyHasDuplicates", { partyId: halcyon2 }).hasDuplicates
        const names = nameMatches({ partyId: halcyon1 }).map((match) => match.partyId)
        const flags = [partyOf(halcyon1).hasDuplicates, partyOf(halcyon2).hasDuplicates]
        const listed = call("mantle.party.DuplicateServices.get#PartyNotDuplicates", { partyId: halcyon2 })
        // the scan of the parties not checked in the last day leaves the pair out too
        for (const partyId of [halcyon1, halcyon2]) call("update#mantle.party.Party", { partyId, hasDuplicates: "N", lastDupCheckDate: effectiveTime - 2 * dayMillis })
        call("mantle.party.DuplicateServices.check#AllPartyDuplicates", {})
        const scanned = [partyOf(halcyon1), partyOf(halcyon2)].map((party) => `${party.hasDuplicates}:${party.lastDupCheckDate > effectiveTime - dayMillis}`)
        // again: the same row, decided anew
        call("mantle.party.DuplicateServices.mark#PartyNotDuplicate", { partyId: halcyon1, otherPartyId: halcyon2 })
        return { before, row, rows, after, has, names, flags, listed, scanned, total: countOf("mantle.party.PartyNotDuplicate", { partyId: lowId, otherPartyId: highId }) }
    },
    then({ before, row, rows, after, has, names, flags, listed, scanned, total }) {
        before[halcyon2].map((info) => info.matchType).sort() == ["email", "name"]
        row.decidedByUserId == "EX_JOHN_DOE"
        row.comments == "Twins"
        rows == 0
        !Object.keys(after).includes(halcyon2)
        has == false
        !names.includes(halcyon2)
        flags == ["N", "N"]
        listed.otherPartyIdList == [halcyon1]
        listed.notDuplicateList[0].comments == "Twins"
        scanned == ["N:true", "N:true"]
        total == 1
    },
})

feature("not a duplicate: never another user's personal contact, nor one party with itself; unmarked it is a duplicate again; a merge carries the decision", {
    when() {
        at(4)
        const personal = errorOf("mantle.party.DuplicateServices.mark#PartyNotDuplicate", { partyId: halcyon1, otherPartyId: erinWrexlowId })
        const same = errorOf("mantle.party.DuplicateServices.mark#PartyNotDuplicate", { partyId: halcyon1, otherPartyId: halcyon1 })
        const unmarked = call("mantle.party.DuplicateServices.unmark#PartyNotDuplicate", { partyId: halcyon1, otherPartyId: halcyon2 }).removed
        const again = Object.keys(duplicatesOf(halcyon1)).includes(halcyon2)
        const flag = partyOf(halcyon2).hasDuplicates
        // a third Halcyon, not a duplicate of the first, merged into the second: the first and second are not duplicates now
        halcyon3 = person("Halcyon", "Brightwater")
        call("mantle.party.DuplicateServices.mark#PartyNotDuplicate", { partyId: halcyon3, otherPartyId: halcyon1 })
        call("mantle.party.DuplicateServices.merge#Parties", { toPartyId: halcyon2, fromPartyId: halcyon3 })
        const carried = call("mantle.party.DuplicateServices.get#PartyNotDuplicates", { partyId: halcyon1 }).otherPartyIdList
        const merged = duplicatesOf(halcyon1)
        return { personal, same, unmarked, again, flag, carried, merged,
            leftOn3: call("mantle.party.DuplicateServices.get#PartyNotDuplicates", { partyId: halcyon3 }).otherPartyIdList }
    },
    then({ personal, same, unmarked, again, flag, carried, merged, leftOn3 }) {
        personal.includes(`Party ${erinWrexlowId} not found`)
        same.includes("two different parties")
        unmarked == true
        again == true
        flag == "Y"
        carried == [halcyon2]
        !Object.keys(merged).includes(halcyon2)
        !Object.keys(merged).includes(halcyon3)
        leftOn3.length == 0
    },
})

feature("delete#Contact: Erin removes her personal contact with nothing referring to it, and one with a message is disabled and leaves her book", {
    when() {
        at(5)
        return as("ctc.erin", () => {
            const plain = call("mantle.party.ContactBookServices.create#PersonalContact", { firstName: "Gone", lastName: "Soonest",
                    emailAddress: "gone.soonest@example.com", contactNumber: "555-7301" })
            const messaged = call("mantle.party.ContactBookServices.create#PersonalContact", { firstName: "Kept", lastName: "Writer" })
            call("create#mantle.party.communication.CommunicationEvent", { communicationEventTypeId: "Message", statusId: "CeSent",
                    fromPartyId: erinPartyId, toPartyId: messaged.partyId, subject: "Hello", entryDate: ec.user.nowTimestamp })
            at(6)
            const removed = call("mantle.party.ContactBookServices.delete#Contact", { partyId: plain.partyId })
            const disabled = call("mantle.party.ContactBookServices.delete#Contact", { partyId: messaged.partyId })
            return {
                plainId: plain.partyId, messagedId: messaged.partyId, removed, disabled,
                plainLeft: [PARTY, "mantle.party.Person", "mantle.party.contact.PartyContactMech", "mantle.party.contact.ContactBookParty"]
                        .map((entityName) => countOf(entityName, { partyId: plain.partyId })),
                messagedParty: partyOf(messaged.partyId),
                messagedInBook: currentCount("mantle.party.contact.ContactBookParty", { partyId: messaged.partyId }),
                messagedRows: countOf("mantle.party.contact.ContactBookParty", { partyId: messaged.partyId }),
            }
        })
    },
    then({ removed, disabled, plainLeft, messagedParty, messagedInBook, messagedRows }) {
        removed.removed == true
        removed.disabled == false
        plainLeft == [0, 0, 0, 0]
        disabled.removed == false
        disabled.disabled == true
        disabled.referencedByList == ["mantle.party.communication.CommunicationEvent.toPartyId"]
        messagedParty.disabled == "Y"
        messagedInBook == 0
        messagedRows == 1
    },
})

feature("delete#Contact: a directory party needs the contact admin permission, never a user's or an internal organization", {
    when() {
        at(7)
        const loner = person("Lonely", "Deletable", { roleTypeId: "Customer" })
        call("mantle.party.ContactServices.create#EmailAddress", { partyId: loner, emailAddress: "lonely.deletable@example.com", contactMechPurposeId: "EmailPrimary" })
        call("mantle.party.DuplicateServices.mark#PartyNotDuplicate", { partyId: loner, otherPartyId: odessaId })
        const target = call("mantle.party.PartyServices.create#Organization", { organizationName: "Deletable Target", roleTypeId: "Customer" }).partyId
        const pointer = person("Pointer", "Deletable")
        call("create#mantle.party.PartyRelationship", { relationshipTypeEnumId: "PrtContact", fromPartyId: pointer, toPartyId: target, fromDate: ec.user.nowTimestamp })
        const erinTries = as("ctc.erin", () => errorOf("mantle.party.ContactBookServices.delete#Contact", { partyId: loner }))
        const user = errorOf("mantle.party.ContactBookServices.delete#Contact", { partyId: erinPartyId })
        const internal = errorOf("mantle.party.ContactBookServices.delete#Contact", { partyId: "ORG_ZIZI_RETAIL" })
        const removed = call("mantle.party.ContactBookServices.delete#Contact", { partyId: loner })
        const kept = call("mantle.party.ContactBookServices.delete#Contact", { partyId: target })
        return { loner, erinTries, user, internal, removed, kept,
            lonerLeft: [PARTY, "mantle.party.PartyRole", "mantle.party.contact.PartyContactMech"].map((entityName) => countOf(entityName, { partyId: loner })),
            notDupLeft: countOf("mantle.party.PartyNotDuplicate", { partyId: loner }) + countOf("mantle.party.PartyNotDuplicate", { otherPartyId: loner }),
            target: partyOf(target), targetRoles: countOf("mantle.party.PartyRole", { partyId: target }), erinMarlowe: partyOf(erinMarloweId) }
    },
    then({ erinTries, user, internal, removed, kept, lonerLeft, notDupLeft, target, targetRoles, erinMarlowe }) {
        erinTries.includes("You may not delete contact")
        erinMarlowe.disabled == "N"
        user.includes("has a user account")
        internal.includes("internal organization")
        removed.removed == true
        lonerLeft == [0, 0, 0]
        notDupLeft == 0
        kept.disabled == true
        kept.referencedByList == ["mantle.party.PartyRelationship.toPartyId"]
        target.disabled == "Y"
        targetRoles == 1
    },
})

feature("delete#Contacts: each contact on its own, a failure named and the rest deleted", {
    when() {
        at(8)
        const free = person("Free", "Bulkdelete")
        const held = person("Held", "Bulkdelete")
        call("create#mantle.party.PartyRelationship", { relationshipTypeEnumId: "PrtContact", fromPartyId: free, toPartyId: held, fromDate: ec.user.nowTimestamp })
        // held is referred to by free's relationship, so it is disabled; that relationship is free's own row, so free is removed
        const out = call("mantle.party.ContactBookServices.delete#Contacts", { partyIdList: [held, erinMarloweId, free, free] })
        return { free, held, out, heldParty: partyOf(held), freeParty: partyOf(free) }
    },
    then({ free, held, out, heldParty, freeParty }) {
        out.disabledPartyIdList == [held]
        out.removedPartyIdList == [free]
        out.removedCount == 1
        out.disabledCount == 1
        out.failedPartyIdList == [erinMarloweId]
        out.failureList[0].error.includes("not found")
        heldParty.disabled == "Y"
        freeParty == null
    },
})

feature("match#Contact gives the matched party's plain name and its id apart, and the import preview shows them", {
    when() {
        const match = call("mantle.party.ContactImportServices.match#Contact", { contact: { emails: [{ emailAddress: "ODESSA@wrexlow-mail.example" }] } })
        const preview = call("mantle.party.ContactImportServices.preview#Contacts", { fileText: "Full Name,E-mail\nOdessa Wrexlow,odessa@wrexlow-mail.example\n" })
        return { match, row: preview.rowList[0] }
    },
    then({ match, row }) {
        match.matchedPartyId == odessaId
        match.matchedPseudoId == partyOf(odessaId).pseudoId
        match.matchedName == "Odessa Wrexlow"
        match.matchReason == "email"
        row.matchedPartyId == odessaId
        row.matchedName == "Odessa Wrexlow"
        row.matchedPseudoId == match.matchedPseudoId
    },
})
