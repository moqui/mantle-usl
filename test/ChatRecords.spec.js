// Chat on the Mantle side of IronStone M10: the chat part of the shell counts (mantle.party.PartyServices.get#ShellCounts
// over org.moqui.impl.ChatServices.get#UnreadCounts) and their publishing by the framework's chat services, the ChatMention
// topic as the framework sends it, a record room's messages in the record's timeline
// (mantle.party.CommunicationServices.get#RecordTimeline, kind chat), and a task, request or event made from a chat message
// (findOrCreate#ChatCommunicationEvent, create#RecordFromChatMessage). New spec, no Groovy original.
function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    return null
}
const effectiveTime = Date.now()
const minute = 60000
// each message at its own minute, so the timeline order is known
const at = (minutes) => ec.user.setEffectiveTime(effectiveTime + minutes * minute)
const CHAT = "org.moqui.impl.ChatServices"
const COMM = "mantle.party.CommunicationServices"
const COUNTS = "mantle.party.PartyServices.get#ShellCounts"
const REQUEST = "mantle.request.Request"
// the spec's people have first names after S, so the directory lists that show 50 people by first name (IronStone BOSS's
// Contacts spec looks for its demo contact Sam) are not pushed past by them when the suites share a database
const user = {}
const party = {}
const room = {}
const seq = {}
let themeResourceAdded = false

spec({
    stepwise: true,
    setupSpec() {
        login("john.doe")
        at(0)
    },
    cleanupSpec() {
        ec.artifactExecution.disableAuthz()
        try {
            if (themeResourceAdded) call("delete#moqui.screen.ScreenThemeResource", { screenThemeId: "DEFAULT_QUASAR", sequenceNum: 398 })
        } finally { ec.artifactExecution.enableAuthz() }
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() {
        ec.artifactExecution.enableAuthz()
        login("john.doe")
    },
})

// run as one of the spec's users (authz stays disabled, so only the services' own checks apply)
function as(first, run) {
    login(`ch.${first.toLowerCase()}`, "moqui1!!")
    try { return run() } finally { login("john.doe") }
}
const send = (first, chatRoomId, body, fields) => as(first, () => call(`${CHAT}.send#Message`, Object.assign({ chatRoomId, body }, fields || {})))
const counts = (first) => as(first, () => call(COUNTS, {}))
const settled = () => ec.factory.waitWorkerPoolEmpty(100)
const mention = (first) => `<span data-mention-id="${user[first]}">@${first}</span>`
const timeline = (first, params) => as(first, () => call(`${COMM}.get#RecordTimeline`, Object.assign({ recordEntityName: REQUEST, recordId: "CH-REQ" }, params || {})))
// wait, a little at a time, until a test is true or the time is up (the shell counts go out on a thread of their own)
function waitFor(test, millis) {
    const deadline = Date.now() + millis
    while (Date.now() < deadline) {
        if (test()) return true
        const pause = Date.now() + 100
        while (Date.now() < pause) { /* the next look in a tenth of a second */ }
    }
    return test()
}

feature("three users, a request, a private room of all three and a room bound to the request", {
    when() {
        for (const first of ["Tia", "Uri", "Vik"]) {
            const username = `ch.${first.toLowerCase()}`
            party[first] = call("mantle.party.PartyServices.create#Person", { firstName: first, lastName: "Chatspec" }).partyId
            user[first] = call("mantle.party.PartyServices.create#PartyUserAccount", { partyId: party[first], emailAddress: `${username}@example.com`,
                    username, newPassword: "moqui1!!", newPasswordVerify: "moqui1!!", timeZone: "America/Chicago" }).userId
        }
        call("create#mantle.request.Request", { requestId: "CH-REQ", requestName: "Chat request", requestTypeEnumId: "RqtSupport",
                statusId: "ReqSubmitted", requestDate: ec.user.nowTimestamp })
        call("create#mantle.request.RequestParty", { requestId: "CH-REQ", partyId: party.Tia, roleTypeId: "Customer", fromDate: ec.user.nowTimestamp })
        call("create#mantle.request.Request", { requestId: "CH-REQ2", requestName: "Request without a room", requestTypeEnumId: "RqtSupport",
                statusId: "ReqSubmitted", requestDate: ec.user.nowTimestamp })
        room.ops = as("Tia", () => call(`${CHAT}.create#Room`, { roomTypeEnumId: "CrtPrivate", roomName: "Ops room",
                memberUserIdList: [user.Uri, user.Vik] })).chatRoomId
        room.request = as("Tia", () => call(`${CHAT}.create#Room`, { roomTypeEnumId: "CrtRecord", recordEntityName: REQUEST, recordId: "CH-REQ",
                memberUserIdList: [user.Uri] })).chatRoomId
        room.direct = as("Tia", () => call(`${CHAT}.create#Room`, { roomTypeEnumId: "CrtDirect", memberUserIdList: [user.Uri] })).chatRoomId
        // Vik hears of the room's mentions only
        as("Vik", () => call(`${CHAT}.set#Notification`, { chatRoomId: room.ops, notificationLevelEnumId: "CnlMentions" }))
        // the counts service of the shell theme, as IronStone BOSS seeds it, unless it is there already
        const themeValues = ec.entity.find("moqui.screen.ScreenThemeResource").condition("screenThemeId", "DEFAULT_QUASAR")
                .condition("resourceTypeEnumId", "STRT_SHELL_COUNTS_SERVICE").count()
        if (themeValues === 0) {
            call("create#moqui.screen.ScreenThemeResource", { screenThemeId: "DEFAULT_QUASAR", sequenceNum: 398,
                    resourceTypeEnumId: "STRT_SHELL_COUNTS_SERVICE", resourceValue: COUNTS })
            themeResourceAdded = true
        }
        return {}
    },
    then() {
        Object.values(user).every((userId) => userId != null)
        Object.values(room).every((chatRoomId) => chatRoomId != null)
    },
})

feature("the chat part of the shell counts: the unread messages from others by each member's level, and none once read", {
    when() {
        const before = counts("Tia").counts.chat
        at(1)
        seq.lunch = send("Uri", room.ops, "<p>Lunch at noon?</p>").eventSeq
        at(2)
        settled()
        const notificationsBefore = as("Tia", () => call("mantle.party.PartyServices.count#UserNotifications", {}))
        seq.report = send("Uri", room.ops, `<p>Hey ${mention("Tia")}, the report is due</p>`,
                { roomUrl: `/qapps/Comms/Chat?chatRoomId=${room.ops}` }).eventSeq
        settled()
        const notificationsAfter = as("Tia", () => call("mantle.party.PartyServices.count#UserNotifications", {}))
        const tia = counts("Tia")
        const vik = counts("Vik")
        const uri = counts("Uri")
        const framework = as("Tia", () => call("org.moqui.impl.ShellServices.get#ShellCounts", {}))
        const internal = call(COUNTS, { userId: user.Tia })
        at(3)
        send("Uri", room.ops, `<p>${mention("Vik")} and you</p>`)
        const vikMentioned = counts("Vik").counts.chat
        const tiaThree = counts("Tia").counts.chat
        as("Tia", () => call(`${CHAT}.mark#Read`, { chatRoomId: room.ops }))
        const tiaRead = counts("Tia")
        return { before, tia, vik, uri, framework, internal, vikMentioned, tiaThree, tiaRead, notificationsBefore, notificationsAfter }
    },
    then({ before, tia, vik, uri, framework, internal, vikMentioned, tiaThree, tiaRead, notificationsBefore, notificationsAfter }) {
        before == 0
        tia.counts.chat == 2
        tia.failedParts == []
        // Vik's level is mentions and Vik is not mentioned; Uri's own messages do not count for him
        vik.counts.chat == 0
        uri.counts.chat == 0
        framework.counts.chat == 2
        internal.counts.chat == 2
        vikMentioned == 1
        tiaThree == 3
        tiaRead.counts.chat == 0
        tiaRead.failedParts == []
        // the mention is in the Notifications inbox (the badge), not in Updates
        notificationsAfter.notificationCount == notificationsBefore.notificationCount + 1
        notificationsAfter.updateCount == notificationsBefore.updateCount
    },
})

feature("a mention is a ChatMention notification as the seed has it: its title, reason, room record, link and message fields", {
    when() {
        const rows = Array.from(ec.entity.find("moqui.security.user.NotificationMessageUser").condition("userId", user.Tia).list())
                .map((row) => ec.entity.find("moqui.security.user.NotificationMessage").condition("notificationMessageId", row.notificationMessageId).one())
                .filter((notice) => notice.topic === "ChatMention")
        const seedErrors = checkData(`<entity-facade-xml>
            <moqui.security.user.NotificationTopic topic="ChatMention" inboxEnumId="NinNotifications" showAlert="Y" persistOnSend="Y"
                    receiveNotifications="Y" isPrivate="Y" emailTemplateId="NOTIFICATION"/>
        </entity-facade-xml>`)
        return { rows, seedErrors, fields: rows.length ? JSON.parse(rows[0].messageJson) : null }
    },
    then({ rows, seedErrors, fields }) {
        seedErrors.length == 0
        rows.length == 1
        rows[0].titleText == "Uri Chatspec mentioned you in Ops room: Hey @Tia, the report is due"
        rows[0].reasonEnumId == "NrMention"
        rows[0].recordEntityName == "moqui.chat.ChatRoom"
        rows[0].recordId == room.ops
        rows[0].linkText == `/qapps/Comms/Chat?chatRoomId=${room.ops}`
        rows[0].actorUserId == user.Uri
        fields.chatRoomId == room.ops
        fields.eventSeq == seq.report
        fields.roomName == "Ops room"
        fields.authorUserId == user.Uri
        fields.authorName == "Uri Chatspec"
        fields.summary == "Hey @Tia, the report is due"
    },
})

// The framework's chat services publish the counts of the users whose chat counts change (publish#ChatCounts through
// org.moqui.impl.ShellServices.publish#ShellCounts, after the commit, on a thread of the server, coalesced per user), so
// Mantle adds no entity ECA for them. The spec hears the shellCounts notifications through the notification capture,
// which listens on the topic as the server's socket does (without a listener nothing is sent; docs/Testing.md).
feature("the counts go to the users whose chat counts change: a new message and a read marker publish them", {
    when() {
        const capture = ec.factory.getTool("NotificationCapture")
        capture.enable()
        try {
            const sentTo = (userId) => capture.getMessages("shellCounts").filter((row) => (row.userIds || []).includes(userId)).length
            const before = sentTo(user.Tia)
            at(4)
            send("Uri", room.ops, "<p>Another one</p>")
            const afterMessage = waitFor(() => sentTo(user.Tia) > before, 15000) ? sentTo(user.Tia) : before
            as("Tia", () => call(`${CHAT}.mark#Read`, { chatRoomId: room.ops }))
            const afterRead = waitFor(() => sentTo(user.Tia) > afterMessage, 15000) ? sentTo(user.Tia) : afterMessage
            // Vik's count is not changed by a message without a mention at the mentions level
            return { before, afterMessage, afterRead, vik: sentTo(user.Vik) }
        } finally {
            capture.disable()
            capture.clear()
        }
    },
    then({ before, afterMessage, afterRead, vik }) {
        afterMessage > before
        afterRead > afterMessage
        vik == 0
    },
})

feature("a record room's messages are in the record's timeline as chat entries: edits applied, a removed one left out, the room's link", {
    when() {
        at(10)
        seq.called = send("Tia", room.request, "<p>The customer called again</p><p>Second line</p>").eventSeq
        at(11)
        seq.callBack = send("Uri", room.request, "<p>I will call back</p>").eventSeq
        at(12)
        seq.wrong = send("Uri", room.request, "<p>wrong room</p>").eventSeq
        at(13)
        as("Uri", () => call(`${CHAT}.redact#Message`, { chatRoomId: room.request, eventSeq: seq.wrong }))
        as("Tia", () => call(`${CHAT}.edit#Message`, { chatRoomId: room.request, eventSeq: seq.called,
                body: "<p>The customer called twice</p><p>Second line</p>" }))
        at(14)
        const all = timeline("Tia", { chatRoomUrl: "/qapps/Comms/Chat" })
        const chats = all.entryList.filter((entry) => entry.kind === "chat")
        const firstPage = timeline("Tia", { pageSize: 1, kinds: "chat" })
        const secondPage = timeline("Tia", { pageSize: 1, kinds: "chat", beforeDate: firstPage.nextBeforeDate, seenKeys: firstPage.nextSeenKeys })
        return { all, chats, firstPage, secondPage, notes: timeline("Tia", { kinds: "notes" }), messages: timeline("Tia", { kinds: "messages" }),
            noRoom: as("Tia", () => call(`${COMM}.get#RecordTimeline`, { recordEntityName: REQUEST, recordId: "CH-REQ2" })) }
    },
    then({ all, chats, firstPage, secondPage, notes, messages, noRoom }) {
        all.failedSources == []
        chats.map((entry) => entry.bodyText) == ["I will call back", "The customer called twice\nSecond line"]
        chats[0].authorUserId == user.Uri
        chats[0].authorPartyId == party.Uri
        chats[0].authorName == "Uri Chatspec"
        chats[0].source == "moqui.chat.ChatEvent"
        chats[0].chatRoomId == room.request
        chats[0].eventSeq == seq.callBack
        chats[0].title == "CH-REQ"
        chats[0].contentType == "text/html"
        chats[0].url == `/qapps/Comms/Chat?chatRoomId=${room.request}&eventSeq=${seq.callBack}`
        chats[0].entryKey == `chat:${room.request}:${seq.callBack}`
        chats[1].body.includes("called twice")
        chats[1].edited == true
        millis(chats[1].date) == effectiveTime + 10 * minute
        // the cursor pages through the room's messages
        firstPage.entryList.map((entry) => entry.eventSeq) == [seq.callBack]
        firstPage.hasMore == true
        secondPage.entryList.map((entry) => entry.eventSeq) == [seq.called]
        secondPage.hasMore == false
        // messages include the chat; notes do not
        notes.entryList.filter((entry) => entry.kind === "chat").length == 0
        messages.entryList.filter((entry) => entry.kind === "chat").length == 2
        // a record with no room has no chat entries and no failure
        noRoom.entryList.filter((entry) => entry.kind === "chat").length == 0
        noRoom.failedSources == []
    },
})

feature("a task from a chat message: named from its first line, the message filed on it, linked to the room's record", {
    when() {
        at(20)
        const task = as("Uri", () => call(`${COMM}.create#RecordFromChatMessage`, { chatRoomId: room.request, eventSeq: seq.called, recordKind: "task" }))
        const workEffort = ec.entity.find("mantle.work.effort.WorkEffort").condition("workEffortId", task.workEffortId).one()
        const assignees = Array.from(ec.entity.find("mantle.work.effort.WorkEffortParty").condition("workEffortId", task.workEffortId).list())
                .map((row) => [row.partyId, row.roleTypeId])
        const commEvent = ec.entity.find("mantle.party.communication.CommunicationEvent").condition("communicationEventId", task.communicationEventId).one()
        const keyRows = Array.from(ec.entity.find("mantle.party.communication.CommunicationEventRecord")
                .condition("communicationEventId", task.communicationEventId).list()).map((row) => [row.recordEntityName, row.recordId])
        const taskTimeline = as("Uri", () => call(`${COMM}.get#RecordTimeline`, { recordEntityName: "mantle.work.effort.WorkEffort",
                recordId: task.workEffortId, kinds: "messages" }))
        return { task, workEffort, assignees, commEvent, keyRows, taskTimeline,
            commJoin: ec.entity.find("mantle.work.effort.WorkEffortCommEvent").condition("workEffortId", task.workEffortId).count(),
            requestJoin: ec.entity.find("mantle.request.RequestWorkEffort").condition("requestId", "CH-REQ").condition("workEffortId", task.workEffortId).count() }
    },
    then({ task, workEffort, assignees, commEvent, keyRows, taskTimeline, commJoin, requestJoin }) {
        task.recordEntityName == "mantle.work.effort.WorkEffort"
        task.recordId == task.workEffortId
        workEffort.workEffortName == "The customer called twice"
        workEffort.description == "The customer called twice\nSecond line"
        workEffort.workEffortTypeEnumId == "WetTask"
        workEffort.purposeEnumId == "WepTask"
        workEffort.ownerPartyId == party.Uri
        assignees == [[party.Uri, "Assignee"]]
        // the message as a communication event from its sender, filed on the task by its own join
        commEvent.communicationEventTypeId == "Chat"
        commEvent.fromPartyId == party.Tia
        commEvent.subject == "CH-REQ"
        commEvent.body.includes("called twice")
        millis(commEvent.entryDate) == effectiveTime + 10 * minute
        keyRows == [["moqui.chat.ChatEvent", `${room.request}::${seq.called}`]]
        commJoin == 1
        taskTimeline.entryList.map((entry) => [entry.kind, entry.communicationEventTypeId, entry.communicationEventId]) ==
            [["message", "Chat", task.communicationEventId]]
        // the room's record (the request) has the task, through its own join
        task.roomRecordEntityName == REQUEST
        task.roomRecordId == "CH-REQ"
        task.roomRecordLinked == true
        requestJoin == 1
    },
})

feature("an event and a request from chat messages: the same message's event is found again; a room with no record links none", {
    when() {
        at(21)
        const event = as("Uri", () => call(`${COMM}.create#RecordFromChatMessage`, { chatRoomId: room.request, eventSeq: seq.called, recordKind: "event",
                name: "Call the customer back", estimatedStartDate: new Date(effectiveTime + 120 * minute) }))
        const eventRow = ec.entity.find("mantle.work.effort.WorkEffort").condition("workEffortId", event.workEffortId).one()
        const calendars = Array.from(ec.entity.find("mantle.work.calendar.CalendarWorkEffort").condition("workEffortId", event.workEffortId).list())
                .map((row) => ec.entity.find("mantle.work.calendar.Calendar").condition("calendarId", row.calendarId).one())
        at(22)
        const request = as("Tia", () => call(`${COMM}.create#RecordFromChatMessage`, { chatRoomId: room.ops, eventSeq: seq.lunch, recordKind: "request" }))
        const requestRow = ec.entity.find(REQUEST).condition("requestId", request.requestId).one()
        const longText = "A".repeat(120) + " and more"
        at(23)
        const longSeq = send("Tia", room.ops, `<p>${longText}</p>`).eventSeq
        const long = as("Tia", () => call(`${COMM}.create#RecordFromChatMessage`, { chatRoomId: room.ops, eventSeq: longSeq, recordKind: "task",
                assignToPartyId: party.Vik }))
        const longRow = ec.entity.find("mantle.work.effort.WorkEffort").condition("workEffortId", long.workEffortId).one()
        return { event, eventRow, calendars, request, requestRow, long, longRow,
            requestJoin: ec.entity.find("mantle.request.RequestCommEvent").condition("requestId", request.requestId).count(),
            eventJoin: ec.entity.find("mantle.request.RequestWorkEffort").condition("requestId", "CH-REQ").condition("workEffortId", event.workEffortId).count(),
            longAssignee: ec.entity.find("mantle.work.effort.WorkEffortParty").condition("workEffortId", long.workEffortId).one() }
    },
    then({ event, eventRow, calendars, request, requestRow, long, longRow, requestJoin, eventJoin, longAssignee }) {
        eventRow.workEffortName == "Call the customer back"
        eventRow.workEffortTypeEnumId == "WetEvent"
        eventRow.purposeEnumId == "WepMeeting"
        millis(eventRow.estimatedStartDate) == effectiveTime + 120 * minute
        millis(eventRow.estimatedCompletionDate) == effectiveTime + 180 * minute
        calendars.map((calendar) => [calendar.ownerPartyId, calendar.isDefault]) == [[party.Uri, "Y"]]
        eventJoin == 1
        event.roomRecordLinked == true
        requestRow.requestName == "Lunch at noon?"
        requestRow.statusId == "ReqSubmitted"
        requestRow.filedByPartyId == party.Tia
        requestJoin == 1
        request.roomRecordEntityName == null
        request.roomRecordLinked == false
        longRow.workEffortName.length == 100
        longRow.workEffortName.endsWith("A…")
        longAssignee.partyId == party.Vik
    },
})

feature("the same message is one communication event; a room the user may not read and an unknown kind are refused", {
    when() {
        at(30)
        const first = as("Uri", () => call(`${COMM}.findOrCreate#ChatCommunicationEvent`, { chatRoomId: room.request, eventSeq: seq.callBack }))
        const again = as("Tia", () => call(`${COMM}.findOrCreate#ChatCommunicationEvent`, { chatRoomId: room.request, eventSeq: seq.callBack }))
        const sameAsTask = as("Uri", () => call(`${COMM}.findOrCreate#ChatCommunicationEvent`, { chatRoomId: room.request, eventSeq: seq.called }))
        const directSeq = send("Tia", room.direct, "<p>Just between us</p>").eventSeq
        return {
            first, again, sameAsTask,
            chatEvents: ec.entity.find("mantle.party.communication.CommunicationEventRecord").condition("recordEntityName", "moqui.chat.ChatEvent")
                    .condition("recordId", `${room.request}::${seq.called}`).count(),
            notMember: as("Vik", () => errorOf(`${COMM}.create#RecordFromChatMessage`, { chatRoomId: room.direct, eventSeq: directSeq, recordKind: "task" })),
            kind: as("Uri", () => errorOf(`${COMM}.create#RecordFromChatMessage`, { chatRoomId: room.request, eventSeq: seq.callBack, recordKind: "note" })),
        }
    },
    then({ first, again, sameAsTask, chatEvents, notMember, kind }) {
        first.created == true
        first.chatMessage.senderUserId == user.Uri
        first.chatMessage.senderPartyId == party.Uri
        first.chatMessage.bodyText == "I will call back"
        first.chatMessage.roomRecordEntityName == REQUEST
        again.created == false
        again.communicationEventId == first.communicationEventId
        sameAsTask.created == false
        chatEvents == 1
        notMember.includes(`Chat room ${room.direct} not found`)
        kind.includes("task, request or event")
    },
})

function millis(value) {
    if (value == null) return null
    if (value instanceof Date) return value.getTime()
    return /^-?\d+$/.test(String(value)) ? Number(value) : Date.parse(String(value))
}
