// mantle.party.ContactBookServices.filter#ContactAddresses: which email addresses are a user's contacts, the hook an automatic
// reply to contacts only asks (the framework's EmailClientServices.filter#ContactAddresses, the STRT_EMAIL_CONTACT_SERVICE theme
// value IronStone sets). A user's personal contacts, the members of the user's personal books and of the shared books shared
// with the user or a group of the user's, and the directory parties of the user's organizations (or of none); never another
// user's personal contact (IronStone R7), a disabled party or an address no longer current. New spec, no Groovy original.
const effectiveTime = Date.now()
const dayMillis = 86400000
const minute = 60000
// each step at its own minute, so date-keyed rows (book members, contact mechanisms) do not collide
const at = (minutes) => ec.user.setEffectiveTime(effectiveTime + minutes * minute)
const SERVICE = "mantle.party.ContactBookServices.filter#ContactAddresses"
const ALL = ["Pat.Personal@Example.org", "bob.friend@example.org", "book.member@example.org", "shared.member@example.org", "Customer@Example.org",
    "other.customer@example.org", "unowned@example.org", "old.address@example.org", "disabled@example.org", "nobody@example.org"]
const users = {}
let orgId, otherOrgId

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

function as(username, run) {
    login(username, "moqui1!!")
    try { return run() } finally { login("john.doe") }
}
// a party with an email address: a role, an owner, disabled, or an address that is no longer current, as asked
function party(firstName, emailAddress, fields, mechFields) {
    const partyId = call("mantle.party.PartyServices.create#Person", Object.assign({ firstName, lastName: "Addressee" }, fields || {})).partyId
    call("mantle.party.ContactServices.create#EmailAddress", Object.assign({ partyId, emailAddress, contactMechPurposeId: "EmailPrimary" }, mechFields || {}))
    return partyId
}
const contactsOf = (userId, list) => call(SERVICE, { userId, emailAddressList: list || ALL }).contactAddressList

feature("two internal organizations, three users (two employees of one, one in a team group) and their contacts", {
    when() {
        orgId = call("mantle.party.PartyServices.create#Organization", { organizationName: "Address Book Co", roleTypeId: "OrgInternal" }).partyId
        otherOrgId = call("mantle.party.PartyServices.create#Organization", { organizationName: "Other Company", roleTypeId: "OrgInternal" }).partyId
        call("create#moqui.security.UserGroup", { userGroupId: "CAD_TEAM", description: "Contact addresses team" })
        for (const [first, username, employed] of [["Alice", "cad.alice", true], ["Bob", "cad.bob", true], ["Carol", "cad.carol", false]]) {
            const partyId = call("mantle.party.PartyServices.create#Person", { firstName: first, lastName: "Mailer" }).partyId
            users[first] = call("mantle.party.PartyServices.create#PartyUserAccount", { partyId, emailAddress: `${username}@example.com`, username,
                    newPassword: "moqui1!!", newPasswordVerify: "moqui1!!" }).userId
            if (employed) call("create#mantle.party.PartyRelationship", { relationshipTypeEnumId: "PrtEmployee", fromPartyId: partyId, fromRoleTypeId: "Employee",
                    toPartyId: orgId, toRoleTypeId: "OrgInternal", fromDate: effectiveTime - dayMillis })
        }
        call("create#moqui.security.UserGroupMember", { userGroupId: "CAD_TEAM", userId: users.Carol, fromDate: effectiveTime - dayMillis })

        at(1)
        // Alice's personal contact (mixed case) and Bob's
        const pat = as("cad.alice", () => call("mantle.party.ContactBookServices.create#PersonalContact", { firstName: "Pat", lastName: "Personal",
                emailAddress: "Pat.Personal@Example.org" }))
        const bobFriend = as("cad.bob", () => call("mantle.party.ContactBookServices.create#PersonalContact", { firstName: "Robin", lastName: "Friend",
                emailAddress: "bob.friend@example.org" }))
        at(2)
        // a party with no role in Alice's own Family book, and one in a shared book Alice shares with Carol's group
        const member = party("Morgan", "book.member@example.org")
        const sharedMember = party("Sam", "shared.member@example.org")
        const family = as("cad.alice", () => {
            const bookId = call("mantle.party.ContactBookServices.create#ContactBook", { contactBookName: "Family" }).contactBookId
            call("mantle.party.ContactBookServices.add#ContactBookParties", { contactBookId: bookId, partyId: member })
            return bookId
        })
        const team = as("cad.alice", () => {
            const bookId = call("mantle.party.ContactBookServices.create#ContactBook", { contactBookName: "Team", visibilityEnumId: "CbvShared" }).contactBookId
            call("mantle.party.ContactBookServices.add#ContactBookParties", { contactBookId: bookId, partyId: sharedMember })
            call("mantle.party.ContactBookServices.share#ContactBook", { contactBookId: bookId, userGroupId: "CAD_TEAM" })
            return bookId
        })
        at(3)
        // the directory: a customer of the organization, one of the other company, a supplier no organization owns; an address
        // that ended, a disabled party
        party("Casey", "Customer@Example.org", { roleTypeId: "Customer", ownerPartyId: orgId })
        party("Olive", "other.customer@example.org", { roleTypeId: "Customer", ownerPartyId: otherOrgId })
        party("Una", "unowned@example.org", { roleTypeId: "Supplier" })
        party("Owen", "old.address@example.org", { roleTypeId: "Customer" }, { fromDate: effectiveTime - 3 * dayMillis, thruDate: effectiveTime - dayMillis })
        party("Dana", "disabled@example.org", { roleTypeId: "Customer", disabled: "Y" })
        return { pat, bobFriend, family, team }
    },
    then({ pat, bobFriend, family, team }) {
        users.Alice != null
        users.Carol != null
        pat.partyId != null
        bobFriend.partyId != null
        family != null
        team != null
    },
})

feature("a user's contacts: personal contacts, own and shared books, the directory of the user's organizations; never another user's personal contact", {
    when() {
        at(4)
        return { alice: contactsOf(users.Alice), bob: contactsOf(users.Bob), carol: contactsOf(users.Carol),
            // the current user by default; the case and repeats of the list do not matter, the order does
            own: as("cad.alice", () => call(SERVICE, { emailAddressList: [" UNOWNED@example.org", "nobody@example.org", "PAT.PERSONAL@EXAMPLE.ORG", "unowned@example.org"] }).contactAddressList),
            none: contactsOf(users.Alice, []) }
    },
    then({ alice, bob, carol, own, none }) {
        alice == ["pat.personal@example.org", "book.member@example.org", "shared.member@example.org", "customer@example.org", "unowned@example.org"]
        // Bob: his own personal contact, the directory of the organization; not Alice's books (the team book is not shared with him)
        bob == ["bob.friend@example.org", "customer@example.org", "unowned@example.org"]
        // Carol: the book shared with her group, and the directory no organization owns; she is in no organization
        carol == ["shared.member@example.org", "unowned@example.org"]
        own == ["unowned@example.org", "pat.personal@example.org"]
        none == []
    },
})

feature("a book member removed, a share ended and a personal contact linked to the directory change who is a contact", {
    when() {
        at(5)
        const member = ec.entity.find("mantle.party.contact.ContactMech").condition("infoString", "book.member@example.org").one()
        const memberPartyId = ec.entity.find("mantle.party.contact.PartyContactMech").condition("contactMechId", member.contactMechId).one().partyId
        const familyId = ec.entity.find("mantle.party.contact.ContactBook").condition("ownerUserId", users.Alice).condition("contactBookName", "Family").one().contactBookId
        as("cad.alice", () => call("mantle.party.ContactBookServices.remove#ContactBookParties", { contactBookId: familyId, partyIdList: [memberPartyId] }))
        const teamId = ec.entity.find("mantle.party.contact.ContactBook").condition("contactBookName", "Team").condition("visibilityEnumId", "CbvShared").one().contactBookId
        as("cad.alice", () => call("mantle.party.ContactBookServices.unshare#ContactBook", { contactBookId: teamId, userGroupId: "CAD_TEAM" }))
        // Bob's personal contact made a directory customer of no organization: now everyone's
        const friend = ec.entity.find("mantle.party.contact.ContactMech").condition("infoString", "bob.friend@example.org").one()
        const friendPartyId = ec.entity.find("mantle.party.contact.PartyContactMech").condition("contactMechId", friend.contactMechId).one().partyId
        as("cad.bob", () => call("mantle.party.ContactBookServices.link#PersonalContactToDirectory", { partyId: friendPartyId, roleTypeId: "Customer" }))
        at(6)
        return { alice: contactsOf(users.Alice), carol: contactsOf(users.Carol) }
    },
    then({ alice, carol }) {
        alice == ["pat.personal@example.org", "bob.friend@example.org", "shared.member@example.org", "customer@example.org", "unowned@example.org"]
        carol == ["bob.friend@example.org", "unowned@example.org"]
    },
})

feature("with authorization on, a user authorized for the service reads only their own contacts", {
    allowMessageErrors: true,
    when() {
        call("create#moqui.security.ArtifactGroup", { artifactGroupId: "CAD_SERVICE", description: "Contact addresses service" })
        call("create#moqui.security.ArtifactGroupMember", { artifactGroupId: "CAD_SERVICE", artifactTypeEnumId: "AT_SERVICE", artifactName: SERVICE,
                nameIsPattern: "N", inheritAuthz: "Y" })
        call("create#moqui.security.ArtifactAuthz", { artifactAuthzId: "CAD_SERVICE", userGroupId: "CAD_TEAM", artifactGroupId: "CAD_SERVICE",
                authzTypeEnumId: "AUTHZT_ALLOW", authzActionEnumId: "AUTHZA_ALL" })
        const run = (userId) => as("cad.carol", () => {
            ec.artifactExecution.enableAuthz()
            let out = null
            let error = ""
            try {
                out = ec.service.sync().name(SERVICE).parameters(Object.assign({ emailAddressList: ALL }, userId ? { userId } : {})).call()
                error = ec.message.getErrorsString() || ""
            } catch (e) { error = String(e.message) }
            ec.message.clearErrors()
            ec.artifactExecution.disableAuthz()
            return { error, list: out ? Array.from(out.contactAddressList || []) : [] }
        })
        return { other: run(users.Alice), own: run(null) }
    },
    then({ other, own }) {
        other.error.includes("only with authorization disabled")
        other.list == []
        own.error == ""
        own.list == ["bob.friend@example.org", "unowned@example.org"]
    },
})
