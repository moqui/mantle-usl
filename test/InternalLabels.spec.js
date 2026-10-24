// Labels on internal messages (CommunicationEventPartyLabel): an EmailLabel of the user's Internal account, on a
// message that user may see. A thread lists the label when any of its messages has it. Another user does not see it
// and cannot apply it. A reply does not inherit it. New spec, no Groovy original.
function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    return null
}
const COMM = "mantle.party.CommunicationServices"
const MAIL = "org.moqui.impl.EmailClientServices"
const JOIN = "mantle.party.communication.CommunicationEventPartyLabel"
const names = (list) => Array.from(list || []).map((label) => label.labelName)
// a fresh pair each run, so a second run does not collide with the users of the first
const stamp = String(Date.now())
const adaUsername = `il.ada.${stamp}`
const benUsername = `il.ben.${stamp}`

spec({
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() {
        ec.artifactExecution.enableAuthz()
        login("john.doe")
    },
})

feature("a recipient labels an internal message, and only that user sees and applies the label", {
    when() {
        login("john.doe")
        const adaParty = call("mantle.party.PartyServices.create#Person", { firstName: "Ada", lastName: "Label" }).partyId
        const benParty = call("mantle.party.PartyServices.create#Person", { firstName: "Ben", lastName: "Label" }).partyId
        call("mantle.party.PartyServices.create#PartyUserAccount", { partyId: adaParty, emailAddress: `${adaUsername}@example.com`,
            username: adaUsername, newPassword: "moqui1!!", newPasswordVerify: "moqui1!!" })
        call("mantle.party.PartyServices.create#PartyUserAccount", { partyId: benParty, emailAddress: `${benUsername}@example.com`,
            username: benUsername, newPassword: "moqui1!!", newPasswordVerify: "moqui1!!" })

        login(adaUsername, "moqui1!!")
        const sent = call(`${COMM}.create#Message`, { subject: "Plans", body: "See you", toPartyId: benParty })
        const eventId = sent.communicationEventId

        login(benUsername, "moqui1!!")
        const accountId = call(`${MAIL}.ensure#InternalAccount`, {}).emailAccountId
        const labelId = call(`${MAIL}.create#EmailLabel`, { emailAccountId: accountId, labelName: "Follow up" }).emailLabelId
        const first = call(`${COMM}.set#InternalMessageLabels`, { communicationEventId: eventId, addLabelIdList: [labelId] })
        const again = call(`${COMM}.set#InternalMessageLabels`, { communicationEventId: eventId, addLabelIdList: [labelId] })
        const found = call(`${COMM}.find#InternalThreads`, { emailLabelId: labelId })
        const byName = call(`${COMM}.find#InternalThreads`, { searchText: "label:follow" })
        const thread = call(`${COMM}.get#InternalThread`, { communicationEventId: eventId })
        const unnamed = errorOf(`${COMM}.set#InternalMessageLabels`, { communicationEventId: eventId })

        login(adaUsername, "moqui1!!")
        call(`${COMM}.reply#CommunicationEvent`, { parentCommEventId: eventId, body: "A reply does not take the label" })
        const adaThread = call(`${COMM}.get#InternalThread`, { communicationEventId: eventId })
        const stolen = errorOf(`${COMM}.set#InternalMessageLabels`, { communicationEventId: eventId, addLabelIdList: [labelId] })
        const joinsAfterReply = ec.entity.find(JOIN).condition("emailLabelId", labelId).count()

        login(benUsername, "moqui1!!")
        const still = call(`${COMM}.find#InternalThreads`, { emailLabelId: labelId })
        const removed = call(`${COMM}.set#InternalMessageLabels`, { rootCommEventId: eventId, removeLabelIdList: [labelId] })
        const after = call(`${COMM}.find#InternalThreads`, { emailLabelId: labelId })
        const cleared = call(`${COMM}.get#InternalThread`, { communicationEventId: eventId })
        const joinsAfterRemove = ec.entity.find(JOIN).condition("emailLabelId", labelId).count()
        const removeMissing = call(`${COMM}.set#InternalMessageLabels`, { communicationEventId: eventId, removeLabelIdList: [labelId] })

        return { first, again, foundSubjects: Array.from(found.threadList).map((row) => row.subject),
            foundLabels: names(found.threadList[0] && found.threadList[0].labelList), byNameCount: Array.from(byName.threadList).length,
            threadLabels: names(thread.labelList), unnamed, adaLabels: names(adaThread.labelList), stolen,
            joinsAfterReply, stillCount: Array.from(still.threadList).length, removed, afterCount: Array.from(after.threadList).length,
            clearedLabels: names(cleared.labelList), joinsAfterRemove, removeMissing }
    },
    then(out) {
        out.first.updatedCount == 1
        out.first.communicationEventIdList.length == 1
        out.again.updatedCount == 0
        out.foundSubjects == ["Plans"]
        out.foundLabels == ["Follow up"]
        out.byNameCount == 1
        out.threadLabels == ["Follow up"]
        out.unnamed.includes("Name the labels to add or remove")
        out.adaLabels == []
        out.stolen.includes("not found")
        out.joinsAfterReply == 1
        out.stillCount == 1
        out.removed.updatedCount == 1
        out.afterCount == 0
        out.clearedLabels == []
        out.joinsAfterRemove == 0
        out.removeMissing.updatedCount == 0
    },
})
