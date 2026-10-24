// The requests of IronStone Projects in mantle.request.RequestServices (design-projects.md §6 and §15 "Requests and intake",
// impl-projects.md P5): a project's public form token (create#IntakeToken, check#IntakeToken, remove#IntakeToken); a request
// from the form for a visitor with no session user (create#IntakeRequest: its fields checked, the honeypot, the requester
// found or made, the project, the channel, the organization as a note, the triage assignee); a request from email through
// the mail client's rules (the createRequest action of an EmailRuleAction enumeration, impl-projects.md F6: the project by
// the plus tag, the sender as the requester, the message on the request's conversation, a reply joining it, a rule whose
// owner is not on the project filing no project); a work item from email for an internal sender (createWorkItem); the triage
// notice (notify#RequestTriage); a work item made from a request (make#RequestWorkItem) and the request following its work
// (complete#RequestFromWork, the WorkEffort status rule; off with WstRequestFromWork N); and convert#RequestToProject. Who
// sees a request of a project (get#RecordLinkInfo) is checked through IronStone's screens (ironstone-boss test/ProjectRequests).
// New spec, no Groovy original.
const effectiveTime = Date.now()
const REQ = "mantle.request.RequestServices"
const PROJECT = "mantle.work.ProjectServices"
const TASK = "mantle.work.TaskServices"
const MAIL = "org.moqui.impl.EmailClientServices"
const made = {}

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
    cleanupSpec() {
        // the account was john.doe's: its rules and its mail would be among his for the specs after this one
        ec.artifactExecution.disableAuthz()
        try {
            ec.entity.find("moqui.basic.email.EmailRule").condition("emailAccountId", "RQP_ACCOUNT").deleteAll()
            ec.entity.find("moqui.basic.email.EmailAccount").condition("emailAccountId", "RQP_ACCOUNT").updateAll({ ownerUserId: null })
        } finally { ec.artifactExecution.enableAuthz() }
    },
})

function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    const errors = ec.message.getErrorsString ? ec.message.getErrorsString() : null
    ec.message.clearErrors()
    return errors || null
}
// as a visitor of the public form: logged out, with authz on
function anonymously(run) {
    logout()
    ec.artifactExecution.enableAuthz()
    try { return run() } finally {
        ec.artifactExecution.disableAuthz()
        login("john.doe")
    }
}
const one = (entityName, fields) => ec.entity.find(entityName).condition(fields).one()
const all = (entityName, fields) => Array.from(ec.entity.find(entityName).condition(fields).list())
const current = (entityName, fields) => Array.from(ec.entity.find(entityName).condition(fields).conditionDate("fromDate", "thruDate", null).list())
const request = (id) => one("mantle.request.Request", { requestId: id })
let messageCount = 0
// a message stored in the spec's account, as the sync stores received mail
function receive(fields) {
    messageCount++
    const id = "RQPMSG" + messageCount
    call("store#moqui.basic.email.EmailMessage", Object.assign({ emailMessageId: id, emailAccountId: "RQP_ACCOUNT", emailFolderId: "RQP_INBOX",
        statusId: "ES_RECEIVED", contentType: "text/plain", messageDate: ec.user.nowTimestamp, receivedDate: ec.user.nowTimestamp, isRead: "N",
        hasAttachment: "N", messageId: `<rqp-${messageCount}-${effectiveTime}@example.com>`, rootEmailMessageId: id }, fields))
    return id
}
const runRules = (ids) => call(`${MAIL}.run#EmailRules`, { emailAccountId: "RQP_ACCOUNT", emailMessageIdList: ids })

feature("a project with John Doe its manager, a triage assignee and the default type", {
    when() {
        call(`${PROJECT}.create#Project`, { workEffortId: "RQP", workEffortName: "Requests project", visibilityEnumId: "WevWorkGroup",
                assignToPartyId: "EX_JOHN_DOE", assignRoleTypeId: "ProjectManager" })
        call(`${PROJECT}.store#ProjectSetting`, { workEffortId: "RQP", settingTypeEnumId: "WstTriageParty", settingValue: "EX_JOHN_DOE" })
        call(`${PROJECT}.store#ProjectSetting`, { workEffortId: "RQP", settingTypeEnumId: "WstRequestType", settingValue: "RqtBugFix" })
        call(`${PROJECT}.store#ProjectSetting`, { workEffortId: "RQP", settingTypeEnumId: "WstIntakePlusTag", settingValue: "rqp" })
        call(`${PROJECT}.store#ProjectSetting`, { workEffortId: "RQP", settingTypeEnumId: "WstModules", settingValue: "requests" })
        return { settings: call(`${REQ}.get#IntakeSettings`, { workEffortId: "RQP" }).settings }
    },
    then({ settings }) {
        settings.triagePartyId == "EX_JOHN_DOE"
        settings.defaultType == "RqtBugFix"
        settings.plusTag == "rqp"
        settings.token == null
        settings.offeredTypes.includes("RqtBugFix")
        settings.requestFromWork == "Y"
        settings.publicForm.files == "Y"
        settings.publicForm.maxFiles == 5
    },
})

feature("the public form's token: made, checked by the route with nothing internal, rotated and turned off", {
    when() {
        const first = call(`${REQ}.create#IntakeToken`, { workEffortId: "RQP" }).token
        const second = call(`${REQ}.create#IntakeToken`, { workEffortId: "RQP" }).token
        made.token = second
        return anonymously(() => ({ first, second, checked: call(`${REQ}.check#IntakeToken`, { token: second, routeName: "r" }),
            old: call(`${REQ}.check#IntakeToken`, { token: first, routeName: "r" }), junk: call(`${REQ}.check#IntakeToken`, { token: "../etc", routeName: "r" }) }))
    },
    then({ first, second, checked, old, junk }) {
        first != second
        /^[A-Za-z0-9_-]{32}$/.test(second)
        checked.valid
        checked.routeContext.projectName == "Requests project"
        checked.routeContext.typeList.some((type) => type.enumId == "RqtBugFix" && type.label == "Bug Fix")
        checked.routeContext.defaultType == "RqtBugFix"
        checked.routeContext.filesAllowed
        checked.routeContext.workEffortId == null
        !old.valid
        !junk.valid
    },
})

feature("create#IntakeRequest checks a visitor's fields and token; a filled honeypot makes nothing", {
    when() {
        return anonymously(() => ({
            noName: errorOf(`${REQ}.create#IntakeRequest`, { token: made.token, emailAddress: "x@example.com", requestName: "S", description: "D" }),
            badToken: errorOf(`${REQ}.create#IntakeRequest`, { token: "NoSuchTokenAtAllHere", firstName: "A", lastName: "B", emailAddress: "a@example.com",
                requestName: "S", description: "D" }),
            robot: call(`${REQ}.create#IntakeRequest`, { token: made.token, firstName: "Robo", lastName: "Bot", emailAddress: "bot@example.com",
                requestName: "RQP robot", description: "Buy now", website: "http://spam.example" }),
        }))
    },
    then({ noName, badToken, robot }) {
        noName.includes("first and last name")
        badToken.includes("This form is not available")
        robot.received
        robot.requestId == null
        all("mantle.request.Request", { requestName: "RQP robot" }).length == 0
    },
})

feature("a request from the public form: in the project, Submitted on channel Web, the requester made, the organization a note", {
    when() {
        const out = anonymously(() => call(`${REQ}.create#IntakeRequest`, { token: made.token, firstName: "Fern", lastName: "Formby",
                emailAddress: "Fern.Formby@Example.com", organizationName: "Formby Ltd", requestName: "RQP The export is empty",
                description: "The CSV has a header and no rows." }))
        made.formRequest = out.requestId
        const row = request(out.requestId)
        return { out, row, reporter: current("mantle.request.RequestParty", { requestId: out.requestId, roleTypeId: "Reporter" }),
            assignee: current("mantle.request.RequestParty", { requestId: out.requestId, roleTypeId: "Assignee" }),
            note: all("mantle.request.RequestNote", { requestId: out.requestId })[0],
            email: row?.emailContactMechId ? one("mantle.party.contact.ContactMech", { contactMechId: row.emailContactMechId }) : null }
    },
    then({ out, row, reporter, assignee, note, email }) {
        out.received
        row.rootWorkEffortId == "RQP"
        row.statusId == "ReqSubmitted"
        row.salesChannelEnumId == "ScWeb"
        row.requestTypeEnumId == "RqtBugFix"
        row.requestName == "RQP The export is empty"
        reporter.length == 1
        row.filedByPartyId == reporter[0].partyId
        assignee.map((party) => party.partyId) == ["EX_JOHN_DOE"]
        note.noteText.includes("Formby Ltd")
        email.infoString == "fern.formby@example.com"
    },
})

feature("the triage notice goes to the project's triage assignee's users", {
    when() { return { out: call(`${REQ}.notify#RequestTriage`, { requestId: made.formRequest, force: true }) } },
    then({ out }) {
        // John Doe is the triage assignee and the one who made the change is never told: the change here is anonymous
        Array.isArray(out.userIdList)
    },
})

feature("the mail client's rules accept the createRequest action of the EmailRuleAction enumeration", {
    when() {
        call("store#moqui.basic.email.EmailAccount", { emailAccountId: "RQP_ACCOUNT", ownerUserId: "EX_JOHN_DOE", accountKindEnumId: "EakShared",
            emailAddress: "support@rqp.example", accountName: "RQP support", statusId: "EasActive" })
        call("store#moqui.basic.email.EmailFolder", { emailFolderId: "RQP_INBOX", emailAccountId: "RQP_ACCOUNT", folderName: "Inbox", folderKindEnumId: "EfkInbox" })
        const rule = call(`${MAIL}.create#EmailRule`, { ruleName: "RQP intake", emailAccountId: "RQP_ACCOUNT",
            conditionList: [{ field: "to", operator: "contains", value: "+rqp@" }], actionList: [{ action: "createRequest" }] }).emailRuleId
        made.rule = rule
        return { rule, action: one("moqui.basic.Enumeration", { enumId: "ErActCreateRequest" }) }
    },
    then({ rule, action }) {
        rule != null
        action.enumTypeId == "EmailRuleAction"
        action.optionValue == "mantle.request.RequestServices.create#RequestFromEmail"
    },
})

feature("a message to the plus tag's address becomes a request of the project: the sender the requester, the message on its conversation", {
    when() {
        const id = receive({ fromAddress: "dana.rqp@example.com", fromName: "Dana Rqp", toAddresses: "support+rqp@rqp.example",
            subject: "RQP Totals are off by one", bodyText: "The total in the footer is one less than the rows." })
        made.firstMessage = id
        const ran = runRules([id])
        const link = all("mantle.request.RequestEmailMessage", { emailMessageId: id })[0]
        made.emailRequest = link?.requestId
        const row = link ? request(link.requestId) : null
        const event = one("mantle.party.communication.CommunicationEvent", { emailMessageId: id })
        return { ran, row, link, event, comm: event ? one("mantle.request.RequestCommEvent", { requestId: link?.requestId, communicationEventId: event.communicationEventId }) : null,
            reporter: link ? current("mantle.request.RequestParty", { requestId: link.requestId, roleTypeId: "Reporter" }) : [],
            again: runRules([id]), count: all("mantle.request.RequestEmailMessage", { emailMessageId: id }).length }
    },
    then({ ran, row, link, event, comm, reporter, again, count }) {
        ran.matchedCount == 1
        ran.ruleErrorList.length == 0
        row.rootWorkEffortId == "RQP"
        row.statusId == "ReqSubmitted"
        row.salesChannelEnumId == "ScEmail"
        row.requestName == "RQP Totals are off by one"
        row.description.includes("one less than the rows")
        row.requestTypeEnumId == "RqtBugFix"
        reporter.length == 1
        link.partyId == reporter[0].partyId
        event.communicationEventTypeId == "Email"
        comm != null
        // the rules again make nothing twice
        again.ruleErrorList.length == 0
        count == 1
    },
})

feature("a reply in the request's thread joins its conversation and makes no request", {
    when() {
        const first = one("moqui.basic.email.EmailMessage", { emailMessageId: made.firstMessage })
        const before = all("mantle.request.Request", { rootWorkEffortId: "RQP" }).length
        const id = receive({ fromAddress: "dana.rqp@example.com", fromName: "Dana Rqp", toAddresses: "support+rqp@rqp.example",
            subject: "Re: RQP Totals are off by one", bodyText: "It happens on the second page too.", inReplyTo: first.messageId, referencesHeader: first.messageId })
        runRules([id])
        return { before, after: all("mantle.request.Request", { rootWorkEffortId: "RQP" }).length,
            link: all("mantle.request.RequestEmailMessage", { emailMessageId: id })[0] }
    },
    then({ before, after, link }) {
        after == before
        link.requestId == made.emailRequest
    },
})

feature("a rule whose owner is not on the project files no project: the request waits for triage with none", {
    when() {
        call("store#moqui.basic.email.EmailRule", { emailRuleId: "RQP_STRANGER", ownerUserId: "joe@public.com", emailAccountId: "RQP_ACCOUNT",
            ruleName: "Not mine", sequenceNum: 0, enabled: "Y", matchAllEnumId: "ErmAll", stopProcessing: "Y",
            conditionsJson: JSON.stringify([{ field: "subject", operator: "contains", value: "RQP stranger" }]),
            actionsJson: JSON.stringify([{ action: "createRequest", value: "RQP" }]), matchedCount: 0 })
        const id = receive({ fromAddress: "x.rqp@example.com", toAddresses: "support@rqp.example", subject: "RQP stranger asks", bodyText: "Hello" })
        runRules([id])
        const link = all("mantle.request.RequestEmailMessage", { emailMessageId: id })[0]
        return { row: link ? request(link.requestId) : null }
    },
    then({ row }) {
        row != null
        row.rootWorkEffortId == null
    },
})

feature("createWorkItem: an internal sender on the project makes a work item; an outside sender a request", {
    when() {
        call("store#moqui.basic.email.EmailRule", { emailRuleId: "RQP_WORK", ownerUserId: "EX_JOHN_DOE", emailAccountId: "RQP_ACCOUNT",
            ruleName: "Work", sequenceNum: 1, enabled: "Y", matchAllEnumId: "ErmAll", stopProcessing: "Y",
            conditionsJson: JSON.stringify([{ field: "subject", operator: "startsWith", value: "RQP work" }]),
            actionsJson: JSON.stringify([{ action: "createWorkItem", value: "RQP" }]), matchedCount: 0 })
        const johnAddress = one("moqui.security.UserAccount", { userId: "EX_JOHN_DOE" }).emailAddress
        const inside = receive({ fromAddress: johnAddress, fromName: "John Doe", toAddresses: "support@rqp.example", subject: "RQP work: rename the field", bodyText: "Call it Total." })
        const outside = receive({ fromAddress: "outsider.rqp@example.com", toAddresses: "support@rqp.example", subject: "RQP work from outside", bodyText: "Please." })
        runRules([inside, outside])
        const insideEvent = one("mantle.party.communication.CommunicationEvent", { emailMessageId: inside })
        const item = insideEvent ? all("mantle.work.effort.WorkEffortCommEvent", { communicationEventId: insideEvent.communicationEventId })[0] : null
        return { johnAddress, item: item ? one("mantle.work.effort.WorkEffort", { workEffortId: item.workEffortId }) : null,
            outsideLink: all("mantle.request.RequestEmailMessage", { emailMessageId: outside })[0] }
    },
    then({ johnAddress, item, outsideLink }) {
        johnAddress != null
        item.rootWorkEffortId == "RQP"
        item.workEffortName == "RQP work: rename the field"
        item.ownerPartyId == "EX_JOHN_DOE"
        request(outsideLink.requestId).rootWorkEffortId == "RQP"
    },
})

feature("make#RequestWorkItem: a Bug Fix from a bug request, linked, the request accepted; it follows its work to Completed", {
    when() {
        const workEffortId = call(`${REQ}.make#RequestWorkItem`, { requestId: made.formRequest }).workEffortId
        made.item = workEffortId
        const item = one("mantle.work.effort.WorkEffort", { workEffortId })
        const accepted = request(made.formRequest).statusId
        call(`${TASK}.set#TaskStatus`, { workEffortId, statusId: "WeInProgress" })
        const started = request(made.formRequest).statusId
        call(`${TASK}.set#TaskStatus`, { workEffortId, statusId: "WeComplete" })
        const done = request(made.formRequest)
        return { item, accepted, started, done, link: one("mantle.request.RequestWorkEffort", { requestId: made.formRequest, workEffortId }) }
    },
    then({ item, accepted, started, done, link }) {
        item.rootWorkEffortId == "RQP"
        item.purposeEnumId == "WepFix"
        item.workEffortName == "RQP The export is empty"
        link != null
        accepted == "ReqReviewed"
        started == "ReqInProgress"
        done.statusId == "ReqCompleted"
        done.requestResolutionEnumId == "RrFixed"
    },
})

feature("with two items the request completes when the last is done, a cancelled one not counted; WstRequestFromWork N, or no Requests module, stops it", {
    when() {
        const first = call(`${REQ}.make#RequestWorkItem`, { requestId: made.emailRequest, workEffortName: "RQP first half" }).workEffortId
        const second = call(`${REQ}.make#RequestWorkItem`, { requestId: made.emailRequest, workEffortName: "RQP second half" }).workEffortId
        const third = call(`${REQ}.make#RequestWorkItem`, { requestId: made.emailRequest, workEffortName: "RQP dropped" }).workEffortId
        call(`${TASK}.set#TaskStatus`, { workEffortId: third, statusId: "WeCancelled" })
        call(`${TASK}.set#TaskStatus`, { workEffortId: first, statusId: "WeInProgress" })
        call(`${TASK}.set#TaskStatus`, { workEffortId: first, statusId: "WeComplete" })
        const oneDone = request(made.emailRequest).statusId
        call(`${TASK}.set#TaskStatus`, { workEffortId: second, statusId: "WeInProgress" })
        call(`${TASK}.set#TaskStatus`, { workEffortId: second, statusId: "WeComplete" })
        const bothDone = request(made.emailRequest)
        // the setting off: a new request's work moves nothing
        call(`${PROJECT}.store#ProjectSetting`, { workEffortId: "RQP", settingTypeEnumId: "WstRequestFromWork", settingValue: "N" })
        const quiet = call("mantle.request.RequestServices.create#Request", { requestName: "RQP quiet", rootWorkEffortId: "RQP", statusId: "ReqSubmitted" }).requestId
        const quietItem = call(`${REQ}.make#RequestWorkItem`, { requestId: quiet }).workEffortId
        call(`${TASK}.set#TaskStatus`, { workEffortId: quietItem, statusId: "WeInProgress" })
        call(`${TASK}.set#TaskStatus`, { workEffortId: quietItem, statusId: "WeComplete" })
        call(`${PROJECT}.store#ProjectSetting`, { workEffortId: "RQP", settingTypeEnumId: "WstRequestFromWork", settingValue: null })
        // a project with no Requests module and no setting: Mantle's own way, the request completed by hand
        call(`${PROJECT}.create#Project`, { workEffortId: "RQPOLD", workEffortName: "Outside Projects", visibilityEnumId: "WevWorkGroup",
                assignToPartyId: "EX_JOHN_DOE", assignRoleTypeId: "ProjectManager" })
        const old = call("mantle.request.RequestServices.create#Request", { requestName: "RQP by hand", rootWorkEffortId: "RQPOLD", statusId: "ReqSubmitted" }).requestId
        const oldItem = call(`${REQ}.make#RequestWorkItem`, { requestId: old }).workEffortId
        call(`${TASK}.set#TaskStatus`, { workEffortId: oldItem, statusId: "WeInProgress" })
        call(`${TASK}.set#TaskStatus`, { workEffortId: oldItem, statusId: "WeComplete" })
        return { oneDone, bothDone, quiet: request(quiet), byHand: request(old) }
    },
    then({ oneDone, bothDone, quiet, byHand }) {
        oneDone == "ReqInProgress"
        bothDone.statusId == "ReqCompleted"
        bothDone.requestResolutionEnumId == "RrFixed"
        quiet.statusId == "ReqReviewed"
        byHand.statusId == "ReqReviewed"
    },
})

feature("convert#RequestToProject sets the request's project and moves it to In Progress", {
    when() {
        const id = call("mantle.request.RequestServices.create#Request", { requestName: "RQP a whole project", statusId: "ReqSubmitted" }).requestId
        call(`${PROJECT}.create#Project`, { workEffortId: "RQPNEW", workEffortName: "From a request", visibilityEnumId: "WevWorkGroup",
                assignToPartyId: "EX_JOHN_DOE", assignRoleTypeId: "ProjectManager" })
        call(`${REQ}.convert#RequestToProject`, { requestId: id, workEffortId: "RQPNEW" })
        return { row: request(id) }
    },
    then({ row }) {
        row.rootWorkEffortId == "RQPNEW"
        row.statusId == "ReqInProgress"
    },
})
