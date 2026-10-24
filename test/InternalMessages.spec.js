// Internal messages (mantle.party.CommunicationServices): each recipient's read, flag, archive and snooze state on its
// CommunicationEventParty row, one row per party, replies that keep the Message type (reply all, reply to sender only),
// find#InternalThreads views, unread counts and date paging, get#InternalThread, set#InternalMessageState,
// count#UnreadInternalMessages, and the existing callers of create#Message and reply#CommunicationEvent: the Mantle side
// of IronStone M5a. Mailboxes are in Mailboxes.spec.js. New spec, no Groovy original.
const effectiveTime = Date.now()
const minute = 60000
const dayMillis = 86400000
// each write at its own minute, so the thread order is known
const at = (minutes) => ec.user.setEffectiveTime(effectiveTime + minutes * minute)
const COMM = "mantle.party.CommunicationServices"
const CE = "mantle.party.communication.CommunicationEvent"
const CEP = "mantle.party.communication.CommunicationEventParty"
const party = {}
const user = {}
const msg = {}

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
    login(`im.${first.toLowerCase()}`, "moqui1!!")
    try { return run() } finally { login("john.doe") }
}
const nameOf = (partyId) => Object.keys(party).find((name) => party[name] === partyId) || partyId
const rowsOf = (communicationEventId) => Array.from(ec.entity.find(CEP).condition("communicationEventId", communicationEventId).list())
        .map((row) => row.getMap())
// the recipients of a message as name to role
function rolesOf(communicationEventId) {
    const roles = {}
    for (const row of rowsOf(communicationEventId)) roles[nameOf(row.partyId)] = row.roleTypeId
    return roles
}
// a message's row of each recipient, by name
function stateOf(communicationEventId) {
    const rows = {}
    for (const row of rowsOf(communicationEventId)) if (row.roleTypeId !== "Watcher") rows[nameOf(row.partyId)] = row
    return rows
}
const eventOf = (id) => ec.entity.find(CE).condition("communicationEventId", id).one()
const send = (first, params) => as(first, () => call(`${COMM}.create#Message`, params))
const reply = (first, params) => as(first, () => call(`${COMM}.reply#CommunicationEvent`, params))
const setState = (first, params) => as(first, () => call(`${COMM}.set#InternalMessageState`, params))
const findThreads = (first, params) => as(first, () => call(`${COMM}.find#InternalThreads`, params || {}))
const threadIds = (first, params) => findThreads(first, params).threadList.map((thread) => thread.threadId)
const unread = (first) => as(first, () => call(`${COMM}.count#UnreadInternalMessages`, {})).unreadCount
const unreadAll = () => {
    const counts = {}
    for (const first of ["Ada", "Ben", "Cora", "Dan", "Eve"]) counts[first] = unread(first)
    return counts
}

feature("five users", {
    when() {
        for (const first of ["Ada", "Ben", "Cora", "Dan", "Eve"]) {
            const username = `im.${first.toLowerCase()}`
            party[first] = call("mantle.party.PartyServices.create#Person", { firstName: first, lastName: "Inmessage" }).partyId
            user[first] = call("mantle.party.PartyServices.create#PartyUserAccount", { partyId: party[first], emailAddress: `${username}@example.com`,
                    username, newPassword: "moqui1!!", newPasswordVerify: "moqui1!!" }).userId
        }
        return {}
    },
    then() {
        Object.keys(party).length == 5
        Object.values(user).every((userId) => userId != null)
    },
})

feature("a message to two users with a cc: a row for each recipient, none for the sender, toPartyId the first to-party", {
    when() {
        at(1)
        const out = send("Ada", { subject: "Quarterly plan", body: "<p>The <b>draft</b> is attached</p>", contentType: "text/html",
                toPartyIdList: [party.Ben, party.Cora], ccPartyIdList: [party.Dan] })
        msg.plan = out.communicationEventId
        return { out, event: eventOf(msg.plan), roles: rolesOf(msg.plan), rows: rowsOf(msg.plan) }
    },
    then({ out, event, roles, rows }) {
        out.toPartyId == party.Ben
        event.toPartyId == party.Ben
        event.fromPartyId == party.Ada
        event.communicationEventTypeId == "Message"
        roles == { Ben: "MessageTo", Cora: "MessageTo", Dan: "MessageCc" }
        rows.every((row) => row.readDate == null && row.statusId == "CepReceived" && row.archivedDate == null)
        out.recipientList.length == 3
    },
})

feature("a party in To, in Cc and mentioned gets one row, its role by priority to, then cc", {
    when() {
        at(2)
        msg.lunch = send("Ada", { subject: "Lunch", body: "Friday?", toPartyIdList: [party.Ben], ccPartyIdList: [party.Ben, party.Cora],
                mentionPartyIdList: [party.Cora, party.Dan] }).communicationEventId
        const unknown = errorOf(`${COMM}.create#Message`, { fromPartyId: party.Ada, subject: "Nobody", toPartyIdList: ["IM_NO_SUCH_PARTY"] })
        return { roles: rolesOf(msg.lunch), rowCount: rowsOf(msg.lunch).length, unknown }
    },
    then({ roles, rowCount, unknown }) {
        roles == { Ben: "MessageTo", Cora: "MessageCc", Dan: "MessageCc" }
        rowCount == 3
        unknown.includes("IM_NO_SUCH_PARTY not found")
    },
})

feature("each recipient's read, flag and archive are their own", {
    when() {
        at(3)
        const read = setState("Ben", { communicationEventId: msg.plan, read: true })
        setState("Cora", { communicationEventId: msg.plan, flagged: true })
        setState("Dan", { communicationEventId: msg.plan, archived: true })
        return { read, rows: stateOf(msg.plan) }
    },
    then({ read, rows }) {
        read.updatedCount == 1
        read.communicationEventIdList == [msg.plan]
        rows.Ben.readDate != null
        rows.Cora.readDate == null
        rows.Dan.readDate == null
        rows.Cora.isFlagged == "Y"
        rows.Ben.isFlagged == null
        rows.Dan.archivedDate != null
        rows.Ben.archivedDate == null
        rows.Cora.archivedDate == null
    },
})

feature("set#InternalMessageState changes every row the party has on the message", {
    when() {
        // a second row of Ben's on the message, as an older link or a merge leaves
        call(`create#${CEP}`, { communicationEventId: msg.lunch, partyId: party.Ben, roleTypeId: "Watcher" })
        const out = setState("Ben", { communicationEventId: msg.lunch, read: true })
        const benRows = rowsOf(msg.lunch).filter((row) => row.partyId === party.Ben)
        return { out, benRows }
    },
    then({ out, benRows }) {
        out.updatedCount == 2
        benRows.length == 2
        benRows.every((row) => row.readDate != null)
    },
})

feature("count#UnreadInternalMessages counts each message once, leaving out archived and snoozed ones", {
    when() {
        const before = unreadAll()
        // Cora snoozes lunch until tomorrow
        setState("Cora", { communicationEventId: msg.lunch, snoozedThruDate: new Date(effectiveTime + dayMillis) })
        const afterSnooze = unread("Cora")
        const byParty = call(`${COMM}.count#UnreadInternalMessages`, { partyId: party.Dan })
        const byUser = call(`${COMM}.count#UnreadInternalMessages`, { userId: user.Dan })
        return { before, afterSnooze, byParty, byUser }
    },
    then({ before, afterSnooze, byParty, byUser }) {
        // Ben read both; Cora has both unread; Dan archived the plan
        before == { Ada: 0, Ben: 0, Cora: 2, Dan: 1, Eve: 0 }
        afterSnooze == 1
        byParty.unreadCount == 1
        byParty.unreadThreadCount == 1
        byUser.unreadCount == 1
    },
})

feature("find#InternalThreads: the Inbox leaves out archived and snoozed threads, which have their own views", {
    when() {
        const planRow = findThreads("Ben").threadList.find((thread) => thread.threadId === msg.plan)
        return {
            benReceived: threadIds("Ben"), coraReceived: threadIds("Cora"), coraSnoozed: threadIds("Cora", { view: "snoozed" }),
            coraFlagged: threadIds("Cora", { view: "flagged" }), coraUnread: threadIds("Cora", { unreadOnly: true }),
            danReceived: threadIds("Dan"), danArchived: threadIds("Dan", { view: "archived" }), adaSent: threadIds("Ada", { view: "sent" }),
            adaReceived: threadIds("Ada"), benSearch: threadIds("Ben", { searchText: "quarterly" }), danAll: threadIds("Dan", { view: "all" }),
            planRow, badView: errorOf(`${COMM}.find#InternalThreads`, { view: "spam" }),
        }
    },
    then({ benReceived, coraReceived, coraSnoozed, coraFlagged, coraUnread, danReceived, danArchived, adaSent, adaReceived, benSearch,
            danAll, planRow, badView }) {
        benReceived == [msg.lunch, msg.plan]
        coraReceived == [msg.plan]
        coraSnoozed == [msg.lunch]
        coraFlagged == [msg.plan]
        coraUnread == [msg.plan]
        danReceived == [msg.lunch]
        danArchived == [msg.plan]
        danAll == [msg.lunch, msg.plan]
        adaSent == [msg.lunch, msg.plan]
        adaReceived.length == 0
        benSearch == [msg.plan]
        planRow.store == "internal"
        planRow.rootCommEventId == msg.plan
        planRow.subject == "Quarterly plan"
        planRow.snippet == "The draft is attached"
        planRow.messageCount == 1
        planRow.unreadCount == 0
        planRow.isFlagged == false
        planRow.fromPartyId == party.Ada
        planRow.participantPartyIdList == [party.Ada, party.Ben, party.Cora, party.Dan]
        planRow.participantList[0].name == "Ada Inmessage"
        planRow.sortDate == effectiveTime + minute
        planRow.contactListId == null
        badView.includes("Unknown view spam")
    },
})

feature("a reply to a Message is a Message, reply all: to the sender and the To recipients, cc the Cc", {
    when() {
        at(4)
        const out = reply("Ben", { parentCommEventId: msg.plan, subject: "Re: Quarterly plan", body: "Looks good" })
        msg.benReply = out.communicationEventId
        return { out, event: eventOf(msg.benReply), roles: rolesOf(msg.benReply) }
    },
    then({ out, event, roles }) {
        out.communicationEventTypeId == "Message"
        event.communicationEventTypeId == "Message"
        event.parentCommEventId == msg.plan
        event.rootCommEventId == msg.plan
        event.toPartyId == party.Ada
        event.fromPartyId == party.Ben
        roles == { Ada: "MessageTo", Cora: "MessageTo", Dan: "MessageCc" }
    },
})

feature("reply to sender only answers the parent's sender alone", {
    when() {
        at(5)
        const out = reply("Cora", { parentCommEventId: msg.benReply, subject: "Re: Quarterly plan", body: "Just between us", replyToSenderOnly: true })
        msg.coraPrivate = out.communicationEventId
        return { event: eventOf(msg.coraPrivate), roles: rolesOf(msg.coraPrivate) }
    },
    then({ event, roles }) {
        event.communicationEventTypeId == "Message"
        event.rootCommEventId == msg.plan
        event.parentCommEventId == msg.benReply
        event.toPartyId == party.Ben
        roles == { Ben: "MessageTo" }
    },
})

feature("a thread is listed at its newest message, with each user's messages and unread count", {
    when() {
        const row = (first, params) => findThreads(first, params).threadList.find((thread) => thread.threadId === msg.plan)
        return { ada: row("Ada"), ben: row("Ben"), cora: row("Cora"), dan: row("Dan"), danReceived: threadIds("Dan"),
            danArchived: threadIds("Dan", { view: "archived" }), counts: unreadAll() }
    },
    then({ ada, ben, cora, dan, danReceived, danArchived, counts }) {
        ada.messageCount == 2
        ada.unreadCount == 1
        ada.sortDate == effectiveTime + 4 * minute
        ben.messageCount == 3
        ben.unreadCount == 1
        ben.sortDate == effectiveTime + 5 * minute
        ben.lastCommEventId == msg.coraPrivate
        ben.snippet == "Just between us"
        cora.messageCount == 3
        cora.unreadCount == 2
        // the reply brought Dan's archived thread back to the Inbox
        dan.messageCount == 2
        dan.unreadCount == 2
        dan.isArchived == false
        danReceived == [msg.plan, msg.lunch]
        danArchived.length == 0
        counts == { Ada: 1, Ben: 1, Cora: 2, Dan: 2, Eve: 0 }
    },
})

feature("get#InternalThread: the messages a user may see, oldest first, with their state; it marks nothing", {
    when() {
        const dan = as("Dan", () => call(`${COMM}.get#InternalThread`, { rootCommEventId: msg.plan }))
        const ben = as("Ben", () => call(`${COMM}.get#InternalThread`, { communicationEventId: msg.coraPrivate }))
        const eve = as("Eve", () => errorOf(`${COMM}.get#InternalThread`, { rootCommEventId: msg.plan }))
        const eveThreads = threadIds("Eve", { view: "all" })
        return { dan, ben, eve, eveThreads, danUnread: unread("Dan") }
    },
    then({ dan, ben, eve, eveThreads, danUnread }) {
        dan.rootCommEventId == msg.plan
        dan.subject == "Quarterly plan"
        dan.messageList.map((message) => message.communicationEventId) == [msg.plan, msg.benReply]
        dan.messageList[0].myState.roleTypeId == "MessageCc"
        dan.messageList[0].myState.archivedDate != null
        dan.messageList[0].toPartyIdList == [party.Ben, party.Cora]
        dan.messageList[0].ccPartyIdList == [party.Dan]
        dan.messageList[1].isUnread == true
        dan.unreadCount == 2
        dan.canReply == true
        dan.isClosed == false
        dan.contactListId == null
        ben.messageList.map((message) => message.communicationEventId) == [msg.plan, msg.benReply, msg.coraPrivate]
        ben.messageList[1].myState == null
        ben.participantList.map((participant) => participant.name) == ["Ada Inmessage", "Ben Inmessage", "Cora Inmessage", "Dan Inmessage"]
        eve.includes("not found")
        eveThreads.length == 0
        danUnread == 2
    },
})

feature("a thread is marked read, archived, unflagged and unsnoozed as a whole", {
    when() {
        at(6)
        const danRead = setState("Dan", { rootCommEventId: msg.plan, read: true })
        const danUnread = unread("Dan")
        setState("Dan", { rootCommEventId: msg.plan, archived: true })
        const danArchived = { received: threadIds("Dan"), archived: threadIds("Dan", { view: "archived" }) }
        setState("Dan", { rootCommEventId: msg.plan, archived: false })
        const danBack = threadIds("Dan")
        setState("Cora", { rootCommEventId: msg.plan, flagged: false })
        const coraFlagged = threadIds("Cora", { view: "flagged" })
        setState("Cora", { communicationEventId: msg.lunch, unsnooze: true })
        const coraReceived = threadIds("Cora")
        setState("Ben", { communicationEventId: msg.lunch, read: false })
        // Cora snoozes the plan for one minute; at minute 8 it is back
        setState("Cora", { rootCommEventId: msg.plan, snoozedThruDate: new Date(effectiveTime + 7 * minute) })
        const coraSnoozed = { received: threadIds("Cora"), snoozed: threadIds("Cora", { view: "snoozed" }) }
        at(8)
        const coraLater = { received: threadIds("Cora"), snoozed: threadIds("Cora", { view: "snoozed" }) }
        return { danRead, danUnread, danArchived, danBack, coraFlagged, coraReceived, coraSnoozed, coraLater, counts: unreadAll() }
    },
    then({ danRead, danUnread, danArchived, danBack, coraFlagged, coraReceived, coraSnoozed, coraLater, counts }) {
        danRead.updatedCount == 2
        danUnread == 1
        danArchived.received == [msg.lunch]
        danArchived.archived == [msg.plan]
        danBack == [msg.plan, msg.lunch]
        coraFlagged.length == 0
        coraReceived == [msg.plan, msg.lunch]
        coraSnoozed.received == [msg.lunch]
        coraSnoozed.snoozed == [msg.plan]
        coraLater.received == [msg.plan, msg.lunch]
        coraLater.snoozed.length == 0
        counts == { Ada: 1, Ben: 2, Cora: 3, Dan: 1, Eve: 0 }
    },
})

feature("paging by the date cursor: a thread with a newer message is not shown twice", {
    when() {
        for (const [minutes, subject] of [[10, "First"], [11, "Second"], [12, "Third"]]) {
            at(minutes)
            msg[subject] = send("Eve", { subject, body: `${subject} note`, toPartyIdList: [party.Ada] }).communicationEventId
        }
        at(13)
        reply("Eve", { parentCommEventId: msg.First, body: "First, again" })
        const first = findThreads("Ada", { pageSize: 2 })
        const second = findThreads("Ada", { pageSize: 2, beforeDate: new Date(first.nextBeforeDate) })
        return { first, second, firstIds: first.threadList.map((thread) => thread.threadId), secondIds: second.threadList.map((thread) => thread.threadId) }
    },
    then({ first, second, firstIds, secondIds }) {
        firstIds == [msg.First, msg.Third]
        first.hasMore == true
        first.nextBeforeDate == effectiveTime + 12 * minute
        first.threadList[0].messageCount == 2
        secondIds == [msg.Second, msg.plan]
        second.hasMore == false
    },
})

feature("existing callers: create#Message with toPartyId, and request and task comment replies stay Comments to the other party", {
    when() {
        at(20)
        const single = call(`${COMM}.create#Message`, { fromPartyId: party.Ada, toPartyId: party.Ben, subject: "One to one", body: "Hi" })
        call("create#mantle.request.Request", { requestId: "IM-R1", requestName: "Internal messages request", requestTypeEnumId: "RqtSupport",
                statusId: "ReqSubmitted", requestDate: ec.user.nowTimestamp })
        as("Ada", () => call("mantle.request.RequestServices.add#RequestComment", { requestId: "IM-R1", subject: "Comment", body: "Please check" }))
        const requestCommentId = ec.entity.find("mantle.request.RequestCommEvent").condition("requestId", "IM-R1").one().communicationEventId
        at(21)
        const requestReply = reply("Ben", { parentCommEventId: requestCommentId, subject: "Re: Comment", body: "Checked" })
        call("mantle.work.TaskServices.create#Task", { workEffortId: "IM-T1", workEffortName: "Internal messages task" })
        as("Ada", () => call("mantle.work.TaskServices.add#TaskComment", { workEffortId: "IM-T1", subject: "Task comment", body: "Started" }))
        const taskCommentId = ec.entity.find("mantle.work.effort.WorkEffortCommEvent").condition("workEffortId", "IM-T1").one().communicationEventId
        at(22)
        const taskReply = reply("Ben", { parentCommEventId: taskCommentId, subject: "Re: Task comment", body: "Thanks" })
        const ownReply = reply("Ada", { parentCommEventId: taskCommentId, body: "Adding a note" })
        return { single, singleRoles: rolesOf(single.communicationEventId), request: eventOf(requestReply.communicationEventId),
            requestRoles: rolesOf(requestReply.communicationEventId), requestCommentId, task: eventOf(taskReply.communicationEventId),
            taskCommentId, own: eventOf(ownReply.communicationEventId), ownRows: rowsOf(ownReply.communicationEventId).length }
    },
    then({ single, singleRoles, request, requestRoles, requestCommentId, task, taskCommentId, own, ownRows }) {
        single.toPartyId == party.Ben
        eventOf(single.communicationEventId).toPartyId == party.Ben
        singleRoles == { Ben: "MessageTo" }
        request.communicationEventTypeId == "Comment"
        request.contactMechTypeEnumId == "CmtWebForm"
        request.parentCommEventId == requestCommentId
        request.rootCommEventId == requestCommentId
        request.toPartyId == party.Ada
        request.fromPartyId == party.Ben
        requestRoles == { Ada: "MessageTo" }
        task.communicationEventTypeId == "Comment"
        task.parentCommEventId == taskCommentId
        task.toPartyId == party.Ada
        own.communicationEventTypeId == "Comment"
        own.toPartyId == null
        ownRows == 0
    },
})

feature("a party's timeline has the messages it is from, to or a recipient of", {
    when() {
        const ids = call(`${COMM}.find#PartyCommunicationEvents`, { partyId: party.Dan, communicationEventTypeId: "Message" })
                .commEventList.map((commEvent) => commEvent.communicationEventId)
        return { ids }
    },
    then({ ids }) {
        ids == [msg.benReply, msg.lunch, msg.plan]
    },
})
