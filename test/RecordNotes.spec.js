// Notes on a record changed and deleted (mantle.party.CommunicationServices update#RecordNote, delete#RecordNote,
// check#RecordNoteAccess, delete#CommunicationEventRows; mantle.request.RequestServices update#RequestComment,
// delete#RequestComment): the author changes a note, which is marked edited and notifies only the users newly mentioned;
// another user may not change it; a user in the ADMIN group deletes another's note; a note with replies and a message
// are refused. The Mantle side of IronStone Chatter's edit and delete. New spec, no
// Groovy original.
function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    return null
}
function as(username, run) {
    login(username)
    try { return run() } finally { login("john.doe") }
}
const effectiveTime = Date.now()
const minute = 60000
const at = (minutes) => ec.user.setEffectiveTime(effectiveTime + minutes * minute)
const REQUEST = "mantle.request.Request"
const WORK = "mantle.work.effort.WorkEffort"
const SHIPMENT = "mantle.shipment.Shipment"
const JOE = "ORG_ZIZI_JD"
const requestUrl = "/qapps/Commons/Requests/RequestDetail?requestId=RN-R1"
let miaUserId, noteId, joeNoteId, shipmentNoteId
const ce = (id) => ec.entity.find("mantle.party.communication.CommunicationEvent").condition("communicationEventId", id).one()
const count = (entityName, fields) => ec.entity.find(entityName).condition(fields).count()
// the notices of a topic a user has about this spec's request
const notices = (userId, topic) => Array.from(ec.entity.find("moqui.security.user.NotificationMessageUser").condition("userId", userId).list())
        .map((row) => ec.entity.find("moqui.security.user.NotificationMessage").condition("notificationMessageId", row.notificationMessageId).one())
        .filter((notice) => notice && notice.topic === topic && JSON.parse(notice.messageJson || "{}").recordId === "RN-R1")
const mention = (userId, name) => `<span data-mention-id="${userId}">@${name}</span>`

spec({
    stepwise: true,
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

feature("a request, a task and a shipment with notes, and a user to mention", {
    when() {
        at(1)
        call("create#mantle.request.Request", { requestId: "RN-R1", requestName: "Record notes request", requestTypeEnumId: "RqtSupport",
                statusId: "ReqSubmitted", requestDate: ec.user.nowTimestamp })
        call("mantle.work.TaskServices.create#Task", { workEffortId: "RN-T1", workEffortName: "Record notes task" })
        call("create#mantle.shipment.Shipment", { shipmentId: "RN-S1", shipmentTypeEnumId: "ShpTpSales", statusId: "ShipInput" })
        const partyId = call("mantle.party.PartyServices.create#Person", { firstName: "Mia", lastName: "Recordnote" }).partyId
        miaUserId = call("mantle.party.PartyServices.create#PartyUserAccount", { partyId, emailAddress: "rn.mia@example.com", username: "rn.mia",
                newPassword: "moqui1!!", newPasswordVerify: "moqui1!!" }).userId
        at(2)
        noteId = call("mantle.party.CommunicationServices.log#RecordNote", { recordEntityName: REQUEST, recordId: "RN-R1", subject: "Access",
                body: `<p>Please look at the access, ${mention(JOE, "Joe Developer")}</p>`, contentType: "text/html", mentionUserIds: [JOE],
                recordUrl: requestUrl }).communicationEventId
        at(3)
        shipmentNoteId = call("mantle.party.CommunicationServices.log#RecordNote", { recordEntityName: SHIPMENT, recordId: "RN-S1",
                body: "Packed in two boxes" }).communicationEventId
        at(4)
        joeNoteId = as("joe.developer", () => {
            ec.artifactExecution.disableAuthz()
            return call("mantle.party.CommunicationServices.log#RecordNote", { recordEntityName: WORK, recordId: "RN-T1", body: "Joe's note on the task" })
                    .communicationEventId
        })
        return { joeMentions: notices(JOE, "ChatterMention").length, note: ce(noteId), joeNote: ce(joeNoteId) }
    },
    then({ joeMentions, note, joeNote }) {
        miaUserId != null
        joeMentions == 1
        note.editedDate == null
        joeNote.fromPartyId == JOE
    },
})

feature("the author changes a note: the text and edited date change, the subject stays, and only the user newly mentioned is notified", {
    when() {
        at(5)
        const out = call("mantle.party.CommunicationServices.update#RecordNote", { recordEntityName: REQUEST, recordId: "RN-R1", communicationEventId: noteId,
                body: `<p>Please look at the access today, ${mention(JOE, "Joe Developer")} and ${mention(miaUserId, "Mia Recordnote")}</p>`,
                contentType: "text/html", mentionUserIds: [JOE, miaUserId], recordUrl: requestUrl })
        const entry = call("mantle.party.CommunicationServices.get#RecordTimeline", { recordEntityName: REQUEST, recordId: "RN-R1" }).entryList
                .find((item) => item.communicationEventId === noteId)
        return { out, note: ce(noteId), joeMentions: notices(JOE, "ChatterMention").length, miaMentions: notices(miaUserId, "ChatterMention"),
            joins: count("mantle.request.RequestCommEvent", { requestId: "RN-R1", communicationEventId: noteId }), entry }
    },
    then({ out, note, joeMentions, miaMentions, joins, entry }) {
        out.mentionedUserIds == [miaUserId]
        out.editedDate != null
        note.body.includes("access today")
        note.subject == "Access"
        note.fromPartyId == "EX_JOHN_DOE"
        note.editedDate != null
        joins == 1
        joeMentions == 1
        miaMentions.length == 1
        miaMentions[0].linkText == requestUrl
        entry.editedDate != null
    },
})

feature("another user may change neither the note nor it as a request comment, and it stays as it was", {
    when() {
        at(6)
        const errors = as("joe.developer", () => {
            ec.artifactExecution.disableAuthz()
            return {
                update: errorOf("mantle.party.CommunicationServices.update#RecordNote", { recordEntityName: REQUEST, recordId: "RN-R1",
                    communicationEventId: noteId, body: "<p>Joe was here</p>" }),
                comment: errorOf("mantle.request.RequestServices.update#RequestComment", { requestId: "RN-R1", communicationEventId: noteId, body: "Joe was here" }),
            }
        })
        return { errors, note: ce(noteId) }
    },
    then({ errors, note }) {
        errors.update.includes("You may change only your own notes")
        errors.comment.includes("You may change only your own comments")
        note.body.includes("access today")
        !note.body.includes("Joe was here")
    },
})

feature("a user in the ADMIN group deletes another's note with its link", {
    when() {
        at(7)
        const out = call("mantle.party.CommunicationServices.delete#RecordNote", { recordEntityName: WORK, recordId: "RN-T1", communicationEventId: joeNoteId })
        return { out, note: ce(joeNoteId), joins: count("mantle.work.effort.WorkEffortCommEvent", { communicationEventId: joeNoteId }) }
    },
    then({ out, note, joins }) {
        out.deleted
        note == null
        joins == 0
    },
})

feature("a note with a reply is not deleted until the reply is; a note on a record without its own join goes with its CommunicationEventRecord", {
    when() {
        at(8)
        const replyId = call("mantle.party.CommunicationServices.log#RecordNote", { recordEntityName: SHIPMENT, recordId: "RN-S1", body: "Three boxes now",
                parentCommEventId: shipmentNoteId }).communicationEventId
        const refused = errorOf("mantle.party.CommunicationServices.delete#RecordNote", { recordEntityName: SHIPMENT, recordId: "RN-S1",
                communicationEventId: shipmentNoteId })
        const reply = call("mantle.party.CommunicationServices.delete#RecordNote", { recordEntityName: SHIPMENT, recordId: "RN-S1", communicationEventId: replyId })
        const note = call("mantle.party.CommunicationServices.delete#RecordNote", { recordEntityName: SHIPMENT, recordId: "RN-S1", communicationEventId: shipmentNoteId })
        return { refused, reply, note, left: count("mantle.party.communication.CommunicationEventRecord", { recordEntityName: SHIPMENT, recordId: "RN-S1" }),
            gone: ce(shipmentNoteId) == null && ce(replyId) == null }
    },
    then({ refused, reply, note, left, gone }) {
        refused.includes("This note has replies")
        reply.deleted
        note.deleted
        left == 0
        gone
    },
})

feature("a message is not changed as a note, and a note is not emptied", {
    when() {
        at(9)
        const messageId = call("mantle.party.CommunicationServices.create#Message", { subject: "Sent", body: "Sent body", fromPartyId: "EX_JOHN_DOE",
                toPartyId: JOE }).communicationEventId
        call("mantle.party.CommunicationServices.link#CommunicationEventRecord", { communicationEventId: messageId, recordEntityName: REQUEST, recordId: "RN-R1" })
        return {
            message: errorOf("mantle.party.CommunicationServices.update#RecordNote", { recordEntityName: REQUEST, recordId: "RN-R1", communicationEventId: messageId,
                body: "Changed" }),
            empty: errorOf("mantle.party.CommunicationServices.update#RecordNote", { recordEntityName: REQUEST, recordId: "RN-R1", communicationEventId: noteId,
                body: "<p> </p>" }),
            sent: ce(messageId),
        }
    },
    then({ message, empty, sent }) {
        message.includes("Only a note or a comment can be changed")
        empty.includes("A note needs its text")
        sent.body == "Sent body"
    },
})

feature("a request comment: its author changes and deletes it through update#RequestComment and delete#RequestComment", {
    when() {
        at(10)
        const commentId = call("mantle.request.RequestServices.add#RequestComment", { requestId: "RN-R1", subject: "Comment", body: "First" }).communicationEventId
        const updated = call("mantle.request.RequestServices.update#RequestComment", { requestId: "RN-R1", communicationEventId: commentId, subject: "Comment",
                body: "Second" })
        const edited = ce(commentId)
        call("mantle.request.RequestServices.delete#RequestComment", { requestId: "RN-R1", communicationEventId: commentId })
        // the edited note of the request through delete#RecordNote, which goes through delete#RequestComment
        const note = call("mantle.party.CommunicationServices.delete#RecordNote", { recordEntityName: REQUEST, recordId: "RN-R1", communicationEventId: noteId })
        return { updated, edited, gone: ce(commentId) == null, note, noteGone: ce(noteId) == null,
            joins: count("mantle.request.RequestCommEvent", { requestId: "RN-R1", communicationEventId: commentId }) }
    },
    then({ updated, edited, gone, note, noteGone, joins }) {
        updated.editedDate != null
        edited.body == "Second"
        edited.fromPartyId == "EX_JOHN_DOE"
        edited.editedDate != null
        gone
        joins == 0
        note.deleted
        noteGone
    },
})
