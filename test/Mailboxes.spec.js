// Mailboxes (mantle.marketing.ContactListServices, and the mailbox side of mantle.party.CommunicationServices): a
// ContactList of type MAILBOX with owners, moderators and members; posts with a row for each member and each
// participant of the thread, one row per party; the posting policies (members, moderators, any user in a help mailbox
// where a poster sees only their own threads); private join requests, accepting, declining and leaving; a member who
// joins later reading the earlier threads as read; Mailbox only delivery; closing a thread; the universal search's
// mailbox limit; and posts kept off party timelines: the Mantle side of IronStone M5a. New spec, no Groovy original.
const effectiveTime = Date.now()
const minute = 60000
// each write at its own minute, so thread order and member rows (keyed by fromDate) are known
const at = (minutes) => ec.user.setEffectiveTime(effectiveTime + minutes * minute)
const COMM = "mantle.party.CommunicationServices"
const LISTS = "mantle.marketing.ContactListServices"
const CEP = "mantle.party.communication.CommunicationEventParty"
const CLP = "mantle.marketing.contact.ContactListParty"
const word = "Qwyxzolt"
const party = {}
const msg = {}
let teamId, newsId, askId

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
function as(first, run) {
    login(`mb.${first.toLowerCase()}`, "moqui1!!")
    try { return run() } finally { login("john.doe") }
}
const asCall = (first, name, params) => as(first, () => call(name, params || {}))
const asError = (first, name, params) => as(first, () => errorOf(name, params || {}))
const nameOf = (partyId) => Object.keys(party).find((name) => party[name] === partyId) || partyId
function rolesOf(communicationEventId) {
    const roles = {}
    for (const row of ec.entity.find(CEP).condition("communicationEventId", communicationEventId).list()) roles[nameOf(row.partyId)] = row.roleTypeId
    return roles
}
const rowCount = (communicationEventId, partyId) => ec.entity.find(CEP).condition({ communicationEventId, partyId }).count()
const post = (first, params) => asCall(first, `${COMM}.create#Message`, params).communicationEventId
const threads = (first, params) => asCall(first, `${COMM}.find#InternalThreads`, params)
const threadIds = (first, params) => threads(first, params).threadList.map((thread) => thread.threadId)
const unread = (first) => asCall(first, `${COMM}.count#UnreadInternalMessages`).unreadCount
const mailboxes = (first, params) => asCall(first, `${LISTS}.find#ContactLists`, Object.assign({ contactListTypeEnumId: "MAILBOX" }, params || {}))
        .contactListList.filter((list) => [teamId, newsId, askId].includes(list.contactListId))
const memberRow = (contactListId, partyId) => Array.from(ec.entity.find(CLP).condition({ contactListId, partyId }).orderBy("-fromDate").list())

feature("seven users", {
    when() {
        for (const first of ["Olga", "Mike", "Mia", "Nina", "Quinn", "Ivan", "Paul"]) {
            const username = `mb.${first.toLowerCase()}`
            party[first] = call("mantle.party.PartyServices.create#Person", { firstName: first, lastName: "Mailbox" }).partyId
            call("mantle.party.PartyServices.create#PartyUserAccount", { partyId: party[first], emailAddress: `${username}@example.com`,
                    username, newPassword: "moqui1!!", newPasswordVerify: "moqui1!!" })
        }
        return {}
    },
    then() {
        Object.keys(party).length == 7
    },
})

feature("create#ContactList makes a private mailbox with its creator as owner; only an owner gives a role", {
    when() {
        at(1)
        teamId = asCall("Olga", `${LISTS}.create#ContactList`, { contactListTypeEnumId: "MAILBOX", contactListName: "Team room",
                description: "The team", memberPartyIdList: [party.Mike, party.Mia] }).contactListId
        asCall("Olga", `${LISTS}.add#ContactListParty`, { contactListId: teamId, partyId: party.Mike, roleTypeId: "ListModerator" })
        const moderatorGives = asError("Mike", `${LISTS}.add#ContactListParty`, { contactListId: teamId, partyId: party.Mia, roleTypeId: "ListModerator" })
        const list = ec.entity.find("mantle.marketing.contact.ContactList").condition("contactListId", teamId).one()
        const members = asCall("Olga", `${LISTS}.find#ContactListParties`, { contactListId: teamId }).memberList
                .map((member) => `${nameOf(member.partyId)}:${member.roleTypeId || "member"}:${member.effectiveDeliveryEnumId}`)
        return { list, members, moderatorGives }
    },
    then({ list, members, moderatorGives }) {
        list.contactListTypeEnumId == "MAILBOX"
        list.isPublic == "N"
        list.postingEnumId == "ClpMembers"
        list.defaultDeliveryEnumId == "CldInbox"
        members == ["Olga:ListOwner:CldInbox", "Mike:ListModerator:CldInbox", "Mia:member:CldInbox"]
        moderatorGives.includes("Only an owner of Team room may give a role")
    },
})

feature("a post reaches each member but the poster, and a member also named in To gets one row (to)", {
    when() {
        at(2)
        msg.standup = post("Mia", { contactListId: teamId, subject: `Standup notes ${word}`, body: "Blocked on review", toPartyIdList: [party.Mike] })
        return { roles: rolesOf(msg.standup), mikeRows: rowCount(msg.standup, party.Mike) }
    },
    then({ roles, mikeRows }) {
        roles == { Mike: "MessageTo", Olga: "MessageMailbox" }
        mikeRows == 1
    },
})

feature("a private mailbox is closed to others: its threads are not found, and it is not listed", {
    expect() {
        const threadsError = asError("Nina", `${COMM}.find#InternalThreads`, { contactListId: teamId })
        threadsError.includes("not found")
        mailboxes("Nina").length == 0
    },
})

feature("a join request waits: the requester sees only the header until an owner or moderator accepts", {
    when() {
        at(3)
        const join = asCall("Nina", `${LISTS}.join#ContactList`, { contactListId: teamId })
        const listed = mailboxes("Nina")
        const pendingThreads = threads("Nina", { contactListId: teamId }).threadList
        const memberAccepts = asError("Mia", `${LISTS}.add#ContactListParty`, { contactListId: teamId, partyId: party.Nina })
        const pending = asCall("Mike", `${LISTS}.find#ContactListParties`, { contactListId: teamId }).pendingList.map((entry) => nameOf(entry.partyId))
        const memberSeesPending = asCall("Mia", `${LISTS}.find#ContactListParties`, { contactListId: teamId }).pendingList.length
        at(4)
        const accepted = asCall("Olga", `${LISTS}.add#ContactListParty`, { contactListId: teamId, partyId: party.Nina })
        return { join, listed, pendingThreads, memberAccepts, pending, memberSeesPending, accepted,
            ninaRows: memberRow(teamId, party.Nina) }
    },
    then({ join, listed, pendingThreads, memberAccepts, pending, memberSeesPending, accepted, ninaRows }) {
        join.statusId == "CLPT_PENDING"
        listed.length == 1
        listed[0].membershipStatusId == "CLPT_PENDING"
        listed[0].isMember == false
        listed[0].canPost == false
        pendingThreads.length == 0
        memberAccepts.includes("Only an owner or moderator of Team room may add members")
        pending == ["Nina"]
        memberSeesPending == 0
        accepted.statusId == "CLPT_ACCEPTED"
        ninaRows.length == 1
        ninaRows[0].statusId == "CLPT_ACCEPTED"
    },
})

feature("a member who joined later reads the earlier threads, as read, and gets the new posts", {
    when() {
        const earlier = threads("Nina", { contactListId: teamId }).threadList
        const earlierUnread = unread("Nina")
        const earlierThread = asCall("Nina", `${COMM}.get#InternalThread`, { rootCommEventId: msg.standup })
        const earlierReceived = threadIds("Nina")
        at(5)
        msg.release = post("Olga", { contactListId: teamId, subject: "Release Friday", body: "Code freeze Thursday" })
        const roles = rolesOf(msg.release)
        const later = { unread: unread("Nina"), received: threadIds("Nina"), mailbox: threadIds("Nina", { contactListId: teamId }) }
        // flagging an earlier post gives the late joiner a row, read
        const flag = asCall("Nina", `${COMM}.set#InternalMessageState`, { communicationEventId: msg.standup, flagged: true })
        const flagRows = Array.from(ec.entity.find(CEP).condition({ communicationEventId: msg.standup, partyId: party.Nina }).list())
        const flagged = threadIds("Nina", { view: "flagged" })
        return { earlier, earlierUnread, earlierThread, earlierReceived, roles, later, flag, flagRows, flagged, afterFlag: unread("Nina") }
    },
    then({ earlier, earlierUnread, earlierThread, earlierReceived, roles, later, flag, flagRows, flagged, afterFlag }) {
        earlier.map((thread) => thread.threadId) == [msg.standup]
        earlier[0].unreadCount == 0
        earlier[0].isUnread == false
        earlier[0].contactListId == teamId
        earlier[0].contactListName == "Team room"
        earlierUnread == 0
        earlierThread.messageList.length == 1
        earlierThread.messageList[0].myState == null
        earlierThread.canReply == true
        earlierReceived.length == 0
        roles == { Mike: "MessageMailbox", Mia: "MessageMailbox", Nina: "MessageMailbox" }
        later.unread == 1
        later.received == [msg.release]
        later.mailbox == [msg.release, msg.standup]
        flag.updatedCount == 1
        flagRows.length == 1
        flagRows[0].roleTypeId == "MessageMailbox"
        flagRows[0].isFlagged == "Y"
        flagRows[0].readDate != null
        flagged == [msg.standup]
        afterFlag == 1
    },
})

feature("a declined request: the requester sees nothing of the mailbox", {
    when() {
        at(6)
        asCall("Quinn", `${LISTS}.join#ContactList`, { contactListId: teamId })
        asCall("Mike", `${LISTS}.decline#ContactListParty`, { contactListId: teamId, partyId: party.Quinn })
        const again = asError("Mike", `${LISTS}.decline#ContactListParty`, { contactListId: teamId, partyId: party.Quinn })
        return { rows: memberRow(teamId, party.Quinn), listed: mailboxes("Quinn"), again }
    },
    then({ rows, listed, again }) {
        rows.length == 1
        rows[0].statusId == "CLPT_REJECTED"
        listed.length == 0
        again.includes("has no pending request")
    },
})

feature("leaving ends the membership: no more posts or reading; the last owner cannot leave", {
    when() {
        at(7)
        const left = asCall("Mia", `${LISTS}.leave#ContactList`, { contactListId: teamId })
        const ownerLeaves = asError("Olga", `${LISTS}.leave#ContactList`, { contactListId: teamId })
        at(8)
        msg.afterMia = post("Olga", { contactListId: teamId, subject: "After Mia", body: "Welcome Nina" })
        return { left, rows: memberRow(teamId, party.Mia), ownerLeaves, roles: rolesOf(msg.afterMia) }
    },
    then({ left, rows, ownerLeaves, roles }) {
        left.left == true
        rows[0].thruDate != null
        ownerLeaves.includes("The last owner of a mailbox cannot leave it")
        roles == { Mike: "MessageMailbox", Nina: "MessageMailbox" }
    },
})

feature("a reply in a mailbox is a Message to the mailbox; reply to sender only leaves the mailbox", {
    when() {
        at(9)
        const replyAll = asCall("Mike", `${COMM}.reply#CommunicationEvent`, { parentCommEventId: msg.standup, subject: "Re: standup", body: "Reviewing now" })
        msg.standupReply = replyAll.communicationEventId
        at(10)
        const toSender = asCall("Nina", `${COMM}.reply#CommunicationEvent`, { parentCommEventId: msg.release, body: "Can we move it?", replyToSenderOnly: true })
        msg.ninaPrivate = toSender.communicationEventId
        const ninaView = asCall("Nina", `${COMM}.get#InternalThread`, { rootCommEventId: msg.release }).messageList.map((message) => message.communicationEventId)
        const mikeView = asCall("Mike", `${COMM}.get#InternalThread`, { rootCommEventId: msg.release }).messageList.map((message) => message.communicationEventId)
        return { replyAll, replyRoles: rolesOf(msg.standupReply), toSender, privateRoles: rolesOf(msg.ninaPrivate), ninaView, mikeView }
    },
    then({ replyAll, replyRoles, toSender, privateRoles, ninaView, mikeView }) {
        replyAll.communicationEventTypeId == "Message"
        replyAll.contactListId == teamId
        replyAll.rootCommEventId == msg.standup
        replyRoles == { Olga: "MessageMailbox", Nina: "MessageMailbox" }
        toSender.communicationEventTypeId == "Message"
        toSender.contactListId == null
        toSender.rootCommEventId == msg.release
        toSender.toPartyId == party.Olga
        privateRoles == { Olga: "MessageTo" }
        ninaView == [msg.release, msg.ninaPrivate]
        mikeView == [msg.release]
    },
})

feature("an announcements mailbox: only owners and moderators post; a public mailbox is read by any user", {
    when() {
        at(11)
        newsId = asCall("Olga", `${LISTS}.create#ContactList`, { contactListTypeEnumId: "MAILBOX", contactListName: "News", isPublic: "Y",
                postingEnumId: "ClpModerators" }).contactListId
        asCall("Olga", `${LISTS}.add#ContactListParty`, { contactListId: newsId, partyId: party.Mike, roleTypeId: "ListModerator" })
        const join = asCall("Paul", `${LISTS}.join#ContactList`, { contactListId: newsId })
        const memberPosts = asError("Paul", `${COMM}.create#Message`, { contactListId: newsId, subject: "Me too" })
        at(12)
        msg.office = post("Mike", { contactListId: newsId, subject: "Office closed Monday", body: "Holiday" })
        const outsider = threads("Nina", { contactListId: newsId }).threadList
        const outsiderThread = asCall("Nina", `${COMM}.get#InternalThread`, { communicationEventId: msg.office })
        return { join, memberPosts, roles: rolesOf(msg.office), outsider, outsiderThread }
    },
    then({ join, memberPosts, roles, outsider, outsiderThread }) {
        join.statusId == "CLPT_ACCEPTED"
        memberPosts.includes("You may not post to mailbox News")
        roles == { Olga: "MessageMailbox", Paul: "MessageMailbox" }
        outsider.map((thread) => thread.threadId) == [msg.office]
        outsider[0].unreadCount == 0
        outsiderThread.messageList.length == 1
        outsiderThread.canReply == false
    },
})

feature("a help mailbox: any user posts, and a poster who is not a member sees only their own threads", {
    when() {
        at(13)
        askId = asCall("Olga", `${LISTS}.create#ContactList`, { contactListTypeEnumId: "MAILBOX", contactListName: "Ask IT",
                postingEnumId: "ClpAnyUser", memberPartyIdList: [party.Mike] }).contactListId
        at(14)
        msg.printer = post("Ivan", { contactListId: askId, subject: "Printer jammed", body: "Second floor" })
        at(15)
        msg.vpn = post("Paul", { contactListId: askId, subject: "VPN down", body: "Since noon" })
        const listed = mailboxes("Ivan").find((list) => list.contactListId === askId)
        const ivanThreads = threadIds("Ivan", { contactListId: askId })
        const mikeThreads = threadIds("Mike", { contactListId: askId })
        const otherThread = asError("Ivan", `${COMM}.get#InternalThread`, { communicationEventId: msg.vpn })
        const ivanBefore = unread("Ivan")
        at(16)
        msg.printerAnswer = asCall("Mike", `${COMM}.reply#CommunicationEvent`, { parentCommEventId: msg.printer, body: "On my way" }).communicationEventId
        const answerRoles = rolesOf(msg.printerAnswer)
        const ivanAfter = { unread: unread("Ivan"), received: threadIds("Ivan") }
        at(17)
        msg.printerThanks = asCall("Ivan", `${COMM}.reply#CommunicationEvent`, { parentCommEventId: msg.printerAnswer, body: "Thanks" }).communicationEventId
        return { printerRoles: rolesOf(msg.printer), listed, ivanThreads, mikeThreads, otherThread, ivanBefore, answerRoles, ivanAfter,
            thanksRoles: rolesOf(msg.printerThanks) }
    },
    then({ printerRoles, listed, ivanThreads, mikeThreads, otherThread, ivanBefore, answerRoles, ivanAfter, thanksRoles }) {
        printerRoles == { Olga: "MessageMailbox", Mike: "MessageMailbox" }
        listed.isMember == false
        listed.canPost == true
        listed.canReadAll == false
        ivanThreads == [msg.printer]
        mikeThreads == [msg.vpn, msg.printer]
        otherThread.includes("not found")
        ivanBefore == 0
        // the poster is a participant of the thread, and not being a member gets it in the Inbox
        answerRoles == { Olga: "MessageMailbox", Ivan: "MessageMailbox" }
        ivanAfter.unread == 1
        ivanAfter.received == [msg.printer]
        thanksRoles == { Olga: "MessageMailbox", Mike: "MessageMailbox" }
    },
})

feature("Mailbox only delivery keeps a mailbox's posts out of the Inbox and its count, not out of the mailbox", {
    when() {
        at(18)
        const before = unread("Olga")
        const delivery = asCall("Olga", `${LISTS}.set#ContactListPartyDelivery`, { contactListId: teamId, deliveryEnumId: "CldMailboxOnly" })
        const after = unread("Olga")
        const received = threadIds("Olga")
        const mailbox = threads("Olga", { contactListId: teamId }).threadList
        at(19)
        msg.retro = post("Nina", { contactListId: teamId, subject: "Retro notes", body: "Went well" })
        const afterPost = unread("Olga")
        return { before, delivery, after, received, mailbox, afterPost }
    },
    then({ before, delivery, after, received, mailbox, afterPost }) {
        // Team: the stand-up and its reply; Nina's private reply; News: the office post; Ask IT: four posts
        before == 8
        delivery.effectiveDeliveryEnumId == "CldMailboxOnly"
        after == 6
        !received.includes(msg.standup)
        received.includes(msg.release)
        received.includes(msg.office)
        mailbox.map((thread) => thread.threadId) == [msg.standup, msg.afterMia, msg.release]
        mailbox[0].unreadCount == 2
        mailbox[0].messageCount == 2
        afterPost == 6
    },
})

feature("close#ListThread: an owner or moderator closes a thread, which then takes no replies in the mailbox", {
    when() {
        at(20)
        const memberCloses = asError("Nina", `${COMM}.close#ListThread`, { communicationEventId: msg.standupReply })
        const closed = asCall("Mike", `${COMM}.close#ListThread`, { communicationEventId: msg.standupReply })
        const replyError = asError("Nina", `${COMM}.reply#CommunicationEvent`, { parentCommEventId: msg.standupReply, body: "One more thing" })
        const toSender = asCall("Nina", `${COMM}.reply#CommunicationEvent`, { parentCommEventId: msg.standup, body: "Privately", replyToSenderOnly: true })
        const row = threads("Nina", { contactListId: teamId }).threadList.find((thread) => thread.threadId === msg.standup)
        const view = asCall("Nina", `${COMM}.get#InternalThread`, { rootCommEventId: msg.standup })
        at(21)
        const reopened = asCall("Mike", `${COMM}.close#ListThread`, { communicationEventId: msg.standup, reopen: true })
        const afterReopen = asCall("Nina", `${COMM}.reply#CommunicationEvent`, { parentCommEventId: msg.standupReply, body: "One more thing" })
        return { memberCloses, closed, replyError, toSender, row, view, reopened, afterReopen }
    },
    then({ memberCloses, closed, replyError, toSender, row, view, reopened, afterReopen }) {
        memberCloses.includes("Only an owner or moderator of Team room may close a thread")
        closed.rootCommEventId == msg.standup
        closed.statusId == "CeResolved"
        replyError.includes("is closed")
        toSender.contactListId == null
        toSender.toPartyId == party.Mia
        row.isClosed == true
        view.isClosed == true
        view.canReply == false
        reopened.statusId == "CeReceived"
        afterReopen.contactListId == teamId
    },
})

feature("find#ContactLists: the mailboxes a user may see, with membership, role, delivery and unread counts", {
    when() {
        const byName = (first, params) => {
            const out = {}
            for (const list of mailboxes(first, params)) out[list.contactListName] = list
            return out
        }
        return { olga: byName("Olga"), nina: byName("Nina"), quinn: Object.keys(byName("Quinn")), ninaMember: Object.keys(byName("Nina", { memberOnly: true })),
            order: mailboxes("Olga").map((list) => list.contactListName), search: Object.keys(byName("Olga", { searchText: "team" })) }
    },
    then({ olga, nina, quinn, ninaMember, order, search }) {
        order == ["Ask IT", "News", "Team room"]
        olga["Team room"].memberRoleTypeId == "ListOwner"
        olga["Team room"].deliveryEnumId == "CldMailboxOnly"
        // the stand-up and its first reply, the retro post, and Nina's reply after reopening
        olga["Team room"].unreadCount == 4
        olga["Team room"].memberCount == 3
        olga["Team room"].lastPostDate != null
        olga["News"].deliveryEnumId == "CldInbox"
        olga["News"].memberCount == 3
        olga["Ask IT"].memberCount == 2
        nina["Team room"].isMember == true
        nina["Team room"].memberRoleTypeId == null
        nina["News"].isMember == false
        nina["News"].canJoin == true
        nina["News"].canReadAll == true
        nina["Ask IT"].isMember == false
        nina["Ask IT"].canPost == true
        nina["Ask IT"].canReadAll == false
        nina["Ask IT"].unreadCount == 0
        quinn == ["Ask IT", "News"]
        ninaMember == ["Team room"]
        search == ["Team room"]
    },
})

feature("the universal search shows a private mailbox post to those who may read the mailbox and to its parties", {
    when() {
        ec.search.indexDocuments(ec.entity.getDataDocuments("MantleCommunicationEvent", { communicationEventId: msg.standup }))
        const finds = (first) => asCall(first, "mantle.search.UniversalSearchServices.search#Universal", { q: word,
                entityType: "MantleCommunicationEvent", limit: 50, highlight: false }).results.some((result) => result.id === msg.standup)
        return { searchAvailable: ec.search.isAvailable(), nina: finds("Nina"), mike: finds("Mike"), mia: finds("Mia"), quinn: finds("Quinn"), paul: finds("Paul") }
    },
    then({ searchAvailable, nina, mike, mia, quinn, paul }) {
        searchAvailable
        // Nina joined after the post and has no row on it; Mia left but wrote it
        nina == true
        mike == true
        mia == true
        quinn == false
        paul == false
    },
})

feature("mailbox posts stay off a party's timeline unless asked for or filed on the party", {
    when() {
        const ids = (params) => call(`${COMM}.find#PartyCommunicationEvents`, Object.assign({ partyId: party.Olga, communicationEventTypeId: "Message" }, params))
                .commEventList.map((commEvent) => commEvent.communicationEventId)
        const byDefault = ids({})
        const withPosts = ids({ includeListPosts: true })
        // Olga has a mailbox row on the stand-up; filing it on her party record writes the _NA_ link
        const record = { communicationEventId: msg.standup, recordEntityName: "mantle.party.Party", recordId: party.Olga }
        const linked = call(`${COMM}.link#CommunicationEventRecord`, record)
        const afterLink = ids({})
        call(`${COMM}.unlink#CommunicationEventRecord`, record)
        return { byDefault, withPosts, linked, afterLink, afterUnlink: ids({}) }
    },
    then({ byDefault, withPosts, linked, afterLink, afterUnlink }) {
        byDefault == [msg.ninaPrivate]
        withPosts.includes(msg.standup)
        withPosts.includes(msg.release)
        withPosts.includes(msg.ninaPrivate)
        linked.created == true
        linked.linkEntityName == "mantle.party.communication.CommunicationEventParty"
        afterLink == [msg.ninaPrivate, msg.standup]
        afterUnlink == [msg.ninaPrivate]
    },
})

feature("remove#ContactListParty and update#ContactList: a moderator removes a member but not an owner; an archived mailbox takes no posts", {
    when() {
        at(22)
        const removeOwner = asError("Mike", `${LISTS}.remove#ContactListParty`, { contactListId: teamId, partyId: party.Olga })
        const moderatorUpdates = asError("Mike", `${LISTS}.update#ContactList`, { contactListId: teamId, description: "Ours" })
        asCall("Mike", `${LISTS}.remove#ContactListParty`, { contactListId: teamId, partyId: party.Nina })
        const removedRows = memberRow(teamId, party.Nina)
        asCall("Olga", `${LISTS}.update#ContactList`, { contactListId: newsId, description: "Company news", archived: true })
        const archivedPost = asError("Mike", `${COMM}.create#Message`, { contactListId: newsId, subject: "Late news" })
        const listed = mailboxes("Olga").map((list) => list.contactListName)
        const withArchived = mailboxes("Olga", { includeArchived: true }).map((list) => list.contactListName)
        const news = ec.entity.find("mantle.marketing.contact.ContactList").condition("contactListId", newsId).one()
        return { removeOwner, moderatorUpdates, removedRows, archivedPost, listed, withArchived, news }
    },
    then({ removeOwner, moderatorUpdates, removedRows, archivedPost, listed, withArchived, news }) {
        removeOwner.includes("Only an owner of Team room may remove an owner")
        moderatorUpdates.includes("Only an owner of the mailbox may change it")
        removedRows[0].thruDate != null
        archivedPost.includes("Mailbox News is archived")
        listed == ["Ask IT", "Team room"]
        withArchived == ["Ask IT", "News", "Team room"]
        news.description == "Company news"
        news.archivedDate != null
    },
})
