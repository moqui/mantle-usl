// The Inbox over both stores and mail on records (mantle.party.CommunicationServices): find#InboxThreads, which merges the
// framework's mail (find#Messages) with the internal threads by date and pages each store by its own date in one cursor,
// views that read one store, a store that fails, get#InboxUnreadCounts and the mail shell count; send#EmailDraft, which
// keeps the records with the draft (EmailMessageRecord) until file#SentEmail files the sent email on them, now or after a
// scheduled send; received mail filed by its account's policy (file#ReceivedEmail from the EmailMessage ECA), personal
// contacts matching only for their owner; the NewMail alert (notify#NewMail). The Mantle side of IronStone M5. No SMTP
// server answers in a spec (the framework's mail sink is in its Rust tests only), so a send fails at once on port 1 as in
// the framework's MailClient.spec.js, and a delivery that works later is record#SendResult, the step after one. New spec,
// no Groovy original.
const effectiveTime = Date.now()
const minute = 60000
const at = (minutes) => ec.user.setEffectiveTime(effectiveTime + minutes * minute)
const COMM = "mantle.party.CommunicationServices"
const MAIL = "org.moqui.impl.EmailClientServices"
const CE = "mantle.party.communication.CommunicationEvent"
const CEP = "mantle.party.communication.CommunicationEventParty"
const EMR = "mantle.party.communication.EmailMessageRecord"
const REQUEST = "mantle.request.Request"
const SHIPMENT = "mantle.shipment.Shipment"
const party = {}
const user = {}
const account = {}
const internal = {}
let mailboxId

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
    if (first === "Dan") ec.user.internalLoginUser("ibx.dan")
    else login(`ibx.${first.toLowerCase()}`, "moqui1!!")
    try { return run() } finally { login("john.doe") }
}
const inbox = (params) => call(`${COMM}.find#InboxThreads`, params || {})
const send = (first, params) => as(first, () => call(`${COMM}.create#Message`, params))
const count = (entityName, fields) => ec.entity.find(entityName).condition(fields).count()
const sorted = (list) => Array.from(list || []).sort()
// the filing and alerts run after the commit, on a service worker
const settle = () => ec.factory.waitWorkerPoolEmpty(100)
function eventOfEmail(emailMessageId) {
    const list = Array.from(ec.entity.find(CE).condition("emailMessageId", emailMessageId).list())
    return list.length ? list[0] : null
}
// a received message in an account's Inbox, at its minute, stored as the sync will (a service, so in a transaction)
function received(emailMessageId, emailAccountId, minutes, fields) {
    const inboxId = ec.entity.find("moqui.basic.email.EmailFolder").condition("emailAccountId", emailAccountId)
        .condition("folderKindEnumId", "EfkInbox").one().emailFolderId
    call("create#moqui.basic.email.EmailMessage", Object.assign({ emailMessageId, emailAccountId, emailFolderId: inboxId, statusId: "ES_RECEIVED",
        subject: `Subject ${emailMessageId}`, body: `<p>Body of ${emailMessageId}</p>`, snippet: `Body of ${emailMessageId}`,
        fromAddress: `${emailMessageId.toLowerCase()}@outside.example.com`, toAddresses: "sales@ibx.example.com", isRead: "N",
        messageDate: new Date(effectiveTime + minutes * minute), receivedDate: new Date(effectiveTime + minutes * minute) }, fields || {}))
}
// a row as E<n> for mail, its subject for an internal thread
const shape = (row) => row.store === "email" ? row.emailMessageId.replace("IBX_", "") : row.subject

feature("users, parties with email addresses, personal contacts, mail accounts and records", {
    when() {
        at(0)
        for (const first of ["Ada", "Ben", "Cy"]) {
            const username = `ibx.${first.toLowerCase()}`
            party[first] = call("mantle.party.PartyServices.create#Person", { firstName: first, lastName: "Inboxer" }).partyId
            user[first] = call("mantle.party.PartyServices.create#PartyUserAccount", { partyId: party[first], emailAddress: `${username}@ibx.example.com`,
                    username, newPassword: "moqui1!!", newPasswordVerify: "moqui1!!" }).userId
        }
        // a user with no party: the internal store has nothing for it
        const dan = ec.entity.makeValue("moqui.security.UserAccount")
        dan.setFields({ userId: "IBX_DAN", username: "ibx.dan", emailAddress: "ibx.dan@ibx.example.com" }, true, null, null)
        dan.create()
        user.Dan = "IBX_DAN"
        for (const [first, address] of [["Carl", "carl.ibx@example.com"], ["Dora", "dora.ibx@example.com"]]) {
            party[first] = call("mantle.party.PartyServices.create#Person", { firstName: first, lastName: "Ibxdirectory" }).partyId
            call("mantle.party.ContactServices.create#EmailAddress", { partyId: party[first], emailAddress: address, contactMechPurposeId: "EmailPrimary" })
        }
        party.Pat = as("Ada", () => call("mantle.party.ContactBookServices.create#PersonalContact", { firstName: "Pat", lastName: "Ibxprivate",
                emailAddress: "pat.ibx@example.com" }).partyId)
        party.Quinn = as("Ben", () => call("mantle.party.ContactBookServices.create#PersonalContact", { firstName: "Quinn", lastName: "Ibxprivate",
                emailAddress: "quinn.ibx@example.com" }).partyId)
        call("create#mantle.request.Request", { requestId: "IBX-R1", requestName: "Inbox request", requestTypeEnumId: "RqtSupport",
                statusId: "ReqSubmitted", requestDate: ec.user.nowTimestamp })
        call("create#mantle.shipment.Shipment", { shipmentId: "IBX-S1", shipmentTypeEnumId: "ShpTpSales", statusId: "ShipInput" })
        // no server listens on port 1, so a send fails at once and waits in the Outbox
        const server = { smtpHost: "127.0.0.1", smtpPort: "1", smtpStartTls: "N" }
        as("Ada", () => {
            account.sales = call(`${MAIL}.create#EmailAccount`, Object.assign({ accountKindEnumId: "EakShared", emailAddress: "sales@ibx.example.com",
                    accountName: "Sales" }, server)).emailAccountId
            account.personal = call(`${MAIL}.create#EmailAccount`, Object.assign({ accountKindEnumId: "EakExternal",
                    emailAddress: "ada.personal@ibx.example.com", accountName: "Personal" }, server)).emailAccountId
            call(`${MAIL}.add#EmailAccountUser`, { emailAccountId: account.sales, userId: user.Ben, permissionEnumId: "EapRead" })
            internal.Ada = call(`${MAIL}.ensure#InternalAccount`, {}).emailAccountId
        })
        account.benHosted = as("Ben", () => call(`${MAIL}.create#EmailAccount`, Object.assign({ accountKindEnumId: "EakHosted",
                emailAddress: "ben@ibx.example.com", accountName: "Ben" }, server)).emailAccountId)
        account.dan = as("Dan", () => call(`${MAIL}.create#EmailAccount`, Object.assign({ accountKindEnumId: "EakExternal",
                emailAddress: "dan@ibx.example.com", accountName: "Dan" }, server)).emailAccountId)
        const filing = (id) => ec.entity.find("moqui.basic.email.EmailAccount").condition("emailAccountId", id).one().recordFilingEnumId
        return { filings: [filing(account.sales), filing(account.personal), filing(account.benHosted)],
            patOwner: ec.entity.find("mantle.party.Party").condition("partyId", party.Pat).one().privateOwnerUserId }
    },
    then({ filings, patOwner }) {
        Object.values(user).every((userId) => userId != null)
        filings == ["ErfAllMatches", "ErfLinkedOnly", "ErfAllMatches"]
        patOwner == user.Ada
        internal.Ada != null
    },
})

feature("the Unified inbox merges both stores by date, and its cursor pages each store by its own date, no row skipped or repeated", {
    when() {
        // Ada's Sales Inbox, two at the same minute, and Ben's messages to Ada between them
        for (const [id, minutes] of [["IBX_E1", 100], ["IBX_E2", 95], ["IBX_E3", 90], ["IBX_E4", 90], ["IBX_E5", 80], ["IBX_E6", 70], ["IBX_E7", 60]])
            received(id, account.sales, minutes)
        const sends = []
        for (const minutes of [98, 93, 90, 85, 75, 65, 55]) {
            at(minutes)
            sends.push(send("Ben", { toPartyId: party.Ada, subject: `I${minutes}`, body: `Internal message ${minutes}` }))
        }
        settle()
        const all = as("Ada", () => inbox({ pageSize: 50 }))
        const pages = []
        as("Ada", () => {
            let cursor = null
            do {
                const page = inbox({ pageSize: 5, cursor })
                pages.push(page)
                cursor = page.nextCursor
            } while (cursor && pages.length < 10)
        })
        const byMessage = as("Ada", () => inbox({ pageSize: 50, threadMode: false }))
        return { all, pages, sends, byMessage }
    },
    then({ all, pages, sends, byMessage }) {
        all.storeList == ["email", "internal"]
        all.failedStores == []
        all.threadList.map(shape) == ["E1", "I98", "E2", "I93", "E4", "E3", "I90", "I85", "E5", "I75", "E6", "I65", "E7", "I55"]
        all.hasMore == false
        all.nextCursor == null
        all.threadList[0].rowKey == "email:IBX_E1"
        all.threadList[1].rowKey == `internal:${all.threadList[1].threadId}`
        // the first page ends before the two mail rows of minute 90, so the second does not skip one of them
        pages.length == 3
        pages.map((page) => page.threadList.length) == [4, 5, 5]
        pages.flatMap((page) => page.threadList.map(shape)) == all.threadList.map(shape)
        new Set(pages.flatMap((page) => page.threadList.map((row) => row.rowKey))).size == 14
        pages[0].nextCursor == `email:${effectiveTime + 95 * minute},internal:${effectiveTime + 93 * minute}`
        pages[1].nextCursor == `email:${effectiveTime + 80 * minute},internal:${effectiveTime + 85 * minute}`
        pages[2].hasMore == false
        pages[2].nextCursor == null
        byMessage.threadList.map(shape) == all.threadList.map(shape)
        byMessage.threadList[0].rowKey == "email:IBX_E1"
        sends.every((out) => out.newMailUserIds.length == 1 && out.newMailUserIds[0] == user.Ada)
    },
})

feature("unread counts per account with the Internal account and the Unified count, and the mail shell count", {
    when() {
        const before = as("Ada", () => call(`${COMM}.get#InboxUnreadCounts`, {}))
        const firstInternal = as("Ada", () => inbox({ emailAccountId: internal.Ada, pageSize: 1 })).threadList[0]
        as("Ada", () => {
            call(`${MAIL}.set#MessageFlags`, { emailMessageId: "IBX_E1", read: true })
            call(`${COMM}.set#InternalMessageState`, { rootCommEventId: firstInternal.threadId, read: true })
        })
        const after = as("Ada", () => call(`${COMM}.get#InboxUnreadCounts`, {}))
        const shell = as("Ada", () => call("mantle.party.PartyServices.get#ShellCounts", {}))
        const benShell = call("mantle.party.PartyServices.get#ShellCounts", { userId: user.Ben })
        return { before, after, shell, benShell, firstInternal }
    },
    then({ before, after, shell, benShell, firstInternal }) {
        firstInternal.subject == "I98"
        before.failedParts == []
        before.accountList.map((item) => item.accountName) == ["Internal", "Personal", "Sales"]
        before.accountList.map((item) => item.unreadCount) == [7, 0, 7]
        before.internalEmailAccountId == internal.Ada
        before.emailUnreadCount == 7
        before.internalUnreadCount == 7
        before.unifiedUnreadCount == 14
        after.accountList.map((item) => item.unreadCount) == [6, 0, 6]
        after.unifiedUnreadCount == 12
        shell.failedParts == []
        shell.counts.email == 6
        shell.counts.messages == 6
        // Ben reads the Sales account too
        benShell.counts.email == 6
    },
})

feature("a view that reads one store calls only that store; an account the user does not reach, or an unknown view, is an error", {
    when() {
        at(110)
        const draftId = as("Ada", () => call(`${MAIL}.save#Draft`, { emailAccountId: account.sales, toAddresses: "carl.ibx@example.com",
                subject: "IBX draft", body: "<p>Draft</p>" }).emailMessageId)
        mailboxId = as("Ada", () => call("mantle.marketing.ContactListServices.create#ContactList", { contactListTypeEnumId: "MAILBOX",
                contactListName: "IBX Team", memberPartyIdList: [party.Ben] }).contactListId)
        at(111)
        send("Ben", { contactListId: mailboxId, subject: "IBX team post", body: "Hello team" })
        const salesInboxId = ec.entity.find("moqui.basic.email.EmailFolder").condition("emailAccountId", account.sales)
            .condition("folderKindEnumId", "EfkInbox").one().emailFolderId
        const views = as("Ada", () => ({
            drafts: inbox({ view: "drafts" }),
            internalAccount: inbox({ emailAccountId: internal.Ada }),
            sales: inbox({ emailAccountId: account.sales }),
            fromFilter: inbox({ fromAddress: "ibx_e2@" }),
            mailbox: inbox({ contactListId: mailboxId }),
            trash: inbox({ view: "trash" }),
            internalDrafts: inbox({ emailAccountId: internal.Ada, view: "drafts" }),
            emailOnly: inbox({ store: "email" }),
            folder: inbox({ emailFolderId: salesInboxId }),
        }))
        const benSent = as("Ben", () => inbox({ store: "internal", view: "sent" }))
        const refused = {
            strangerAccount: as("Cy", () => errorOf(`${COMM}.find#InboxThreads`, { emailAccountId: account.sales })),
            badView: as("Ada", () => errorOf(`${COMM}.find#InboxThreads`, { view: "everything" })),
        }
        return { draftId, views, benSent, refused, salesInboxId }
    },
    then({ draftId, views, benSent, refused, salesInboxId }) {
        views.drafts.storeList == ["email"]
        views.drafts.threadList.map((row) => row.emailMessageId) == [draftId]
        views.internalAccount.storeList == ["internal"]
        views.internalAccount.threadList.map((row) => row.subject) == ["IBX team post", "I98", "I93", "I90", "I85", "I75", "I65", "I55"]
        views.sales.storeList == ["email"]
        views.sales.threadList.length == 7
        views.fromFilter.storeList == ["email"]
        views.fromFilter.threadList.map(shape) == ["E2"]
        views.mailbox.storeList == ["internal"]
        views.mailbox.threadList.map((row) => row.subject) == ["IBX team post"]
        views.trash.storeList == ["email"]
        views.trash.threadList == []
        views.internalDrafts.storeList == []
        views.internalDrafts.threadList == []
        views.emailOnly.storeList == ["email"]
        views.emailOnly.threadList.length == 7
        benSent.storeList == ["internal"]
        benSent.threadList.length == 8
        refused.strangerAccount.includes(`Email account ${account.sales} not found`)
        refused.badView.includes("Unknown view everything")
        views.folder.storeList == ["email"]
        views.folder.threadList.length == 7
    },
})

feature("a store that fails is left out and named, and the other store's rows still come", {
    when() {
        received("IBX_D1", account.dan, 120, { toAddresses: "dan@ibx.example.com" })
        settle()
        return { out: as("Dan", () => inbox({})) }
    },
    then({ out }) {
        out.storeList == ["email", "internal"]
        out.failedStores == ["internal"]
        out.threadList.map((row) => row.emailMessageId) == ["IBX_D1"]
        out.hasMore == false
        out.nextCursor == null
    },
})

feature("send#EmailDraft keeps the records with the draft and files the email on them when it is sent", {
    when() {
        at(130)
        const draftId = as("Ada", () => call(`${MAIL}.save#Draft`, { emailAccountId: account.sales, toAddresses: "\"Carl Ibxdirectory\" <carl.ibx@example.com>",
                ccAddresses: "dora.ibx@example.com", subject: "IBX quote", body: "<p>Your quote</p>" }).emailMessageId)
        const refusedSender = as("Ben", () => errorOf(`${COMM}.send#EmailDraft`, { emailMessageId: draftId, recordEntityName: REQUEST, recordId: "IBX-R1" }))
        const out = as("Ada", () => call(`${COMM}.send#EmailDraft`, { emailMessageId: draftId,
                recordList: [{ recordEntityName: REQUEST, recordId: "IBX-R1" }, { recordEntityName: SHIPMENT, recordId: "IBX-S1" }] }))
        settle()
        const waiting = { pending: count(EMR, { emailMessageId: draftId }), events: count(CE, { emailMessageId: draftId }) }
        // the retry that goes out: record#SendResult is what the framework does after a delivery
        call(`${MAIL}.record#SendResult`, { emailMessageId: draftId, messageId: "<ibx-quote@ibx.example.com>" })
        settle()
        const event = eventOfEmail(draftId)
        const eventId = event?.communicationEventId ?? "none"
        return { draftId, refusedSender, out, waiting, event, pending: count(EMR, { emailMessageId: draftId }),
            requestJoin: count("mantle.request.RequestCommEvent", { requestId: "IBX-R1", communicationEventId: eventId }),
            shipmentLink: ec.entity.find("mantle.party.communication.CommunicationEventRecord").condition({ communicationEventId: eventId,
                recordEntityName: SHIPMENT, recordId: "IBX-S1" }).one(),
            doraRow: count(CEP, { communicationEventId: eventId, partyId: party.Dora, roleTypeId: "MessageCc" }),
            requestTimeline: as("Ada", () => call(`${COMM}.get#RecordTimeline`, { recordEntityName: REQUEST, recordId: "IBX-R1", kinds: "messages" }))
                    .entryList.map((entry) => entry.communicationEventId) }
    },
    then({ draftId, refusedSender, out, waiting, event, pending, requestJoin, shipmentLink, doraRow, requestTimeline }) {
        refusedSender.includes(`You may not send from email account ${account.sales}`)
        out.sent == false
        out.statusId == "ES_READY"
        out.sendError != null
        out.pendingRecordList == [{ recordEntityName: REQUEST, recordId: "IBX-R1" }, { recordEntityName: SHIPMENT, recordId: "IBX-S1" }]
        waiting.pending == 2
        waiting.events == 0
        event != null
        event.communicationEventTypeId == "Email"
        event.statusId == "CeSent"
        event.fromPartyId == party.Ada
        event.toPartyId == party.Carl
        doraRow == 1
        pending == 0
        requestJoin == 1
        shipmentLink.linkedByUserId == user.Ada
        requestTimeline.includes(event.communicationEventId)
    },
})

feature("a scheduled send keeps its records through a cancel until send#DueDrafts sends it", {
    when() {
        at(140)
        const draftId = as("Ada", () => call(`${MAIL}.save#Draft`, { emailAccountId: account.sales, toAddresses: "carl.ibx@example.com",
                subject: "IBX scheduled", body: "<p>Later</p>" }).emailMessageId)
        const sendAt = new Date(effectiveTime + 200 * minute)
        const out = as("Ada", () => call(`${COMM}.send#EmailDraft`, { emailMessageId: draftId, scheduledSendDate: sendAt,
                recordEntityName: REQUEST, recordId: "IBX-R1" }))
        const statusOf = () => ec.entity.find("moqui.basic.email.EmailMessage").condition("emailMessageId", draftId).one().statusId
        const scheduled = { statusId: statusOf(), pending: count(EMR, { emailMessageId: draftId }), events: count(CE, { emailMessageId: draftId }) }
        as("Ada", () => call(`${MAIL}.cancel#ScheduledSend`, { emailMessageId: draftId }))
        const afterCancel = { statusId: statusOf(), pending: count(EMR, { emailMessageId: draftId }) }
        // sent again with no record: it keeps the one it has
        const again = as("Ada", () => call(`${COMM}.send#EmailDraft`, { emailMessageId: draftId, scheduledSendDate: sendAt }))
        at(201)
        const due = call(`${MAIL}.send#DueDrafts`, { emailMessageId: draftId })
        settle()
        const afterDue = { statusId: statusOf(), pending: count(EMR, { emailMessageId: draftId }), events: count(CE, { emailMessageId: draftId }) }
        call(`${MAIL}.record#SendResult`, { emailMessageId: draftId, messageId: "<ibx-scheduled@ibx.example.com>" })
        settle()
        const event = eventOfEmail(draftId)
        return { out, scheduled, afterCancel, again, due, afterDue, event, pending: count(EMR, { emailMessageId: draftId }),
            requestJoin: count("mantle.request.RequestCommEvent", { requestId: "IBX-R1", communicationEventId: event?.communicationEventId ?? "none" }) }
    },
    then({ out, scheduled, afterCancel, again, due, afterDue, event, pending, requestJoin }) {
        out.statusId == "ES_SCHEDULED"
        out.scheduledSendDate == effectiveTime + 200 * minute
        out.pendingRecordList == [{ recordEntityName: REQUEST, recordId: "IBX-R1" }]
        scheduled.statusId == "ES_SCHEDULED"
        scheduled.pending == 1
        scheduled.events == 0
        afterCancel.statusId == "ES_DRAFT"
        afterCancel.pending == 1
        again.statusId == "ES_SCHEDULED"
        again.pendingRecordList.length == 1
        due.failedCount == 1
        afterDue.statusId == "ES_READY"
        afterDue.pending == 1
        afterDue.events == 0
        event.toPartyId == party.Carl
        pending == 0
        requestJoin == 1
    },
})

feature("received mail is filed on the matching parties in an account that files every match, not in one that files only what is linked", {
    when() {
        received("IBX_R1", account.sales, 150, { fromAddress: "\"Carl Ibxdirectory\" <Carl.IBX@example.com>", ccAddresses: "dora.ibx@example.com",
                subject: "IBX question" })
        received("IBX_R2", account.personal, 151, { fromAddress: "carl.ibx@example.com", toAddresses: "ada.personal@ibx.example.com",
                subject: "IBX personal note" })
        received("IBX_R3", account.sales, 152, { fromAddress: "nobody@outside.example.com", subject: "IBX unknown" })
        settle()
        const r1 = eventOfEmail("IBX_R1")
        const subjectsOf = (partyId) => call(`${COMM}.find#PartyCommunicationEvents`, { partyId }).commEventList.map((item) => item.subject)
        const personalBefore = count(CE, { emailMessageId: "IBX_R2" })
        const carl = subjectsOf(party.Carl)
        const dora = subjectsOf(party.Dora)
        // the owner of the personal account links that one
        const ownerLink = as("Ada", () => call(`${COMM}.link#CommunicationEventRecord`, { emailMessageId: "IBX_R2",
                recordEntityName: REQUEST, recordId: "IBX-R1" }))
        return { r1, r1Dora: count(CEP, { communicationEventId: r1?.communicationEventId ?? "none", partyId: party.Dora, roleTypeId: "MessageCc" }),
            r3: count(CE, { emailMessageId: "IBX_R3" }), carl, dora, personalBefore, ownerLink, r2: eventOfEmail("IBX_R2") }
    },
    then({ r1, r1Dora, r3, carl, dora, personalBefore, ownerLink, r2 }) {
        r1.communicationEventTypeId == "Email"
        r1.fromPartyId == party.Carl
        r1.toPartyId == null
        r1.statusId == "CeReceived"
        r1Dora == 1
        r3 == 0
        carl.includes("IBX question")
        carl.includes("IBX quote")
        carl.includes("IBX scheduled")
        !carl.includes("IBX personal note")
        dora.includes("IBX question")
        personalBefore == 0
        ownerLink.communicationEventId == r2.communicationEventId
        ownerLink.linkEntityName == "mantle.request.RequestCommEvent"
        r2.fromPartyId == party.Carl
    },
})

feature("a personal contact matches only for the accounts of its owner", {
    when() {
        received("IBX_P1", account.sales, 160, { fromAddress: "pat.ibx@example.com", subject: "IBX from Pat" })
        // Quinn is Ben's contact; Ben reads Sales, which Ada owns
        received("IBX_P2", account.sales, 161, { fromAddress: "quinn.ibx@example.com", subject: "IBX from Quinn" })
        received("IBX_P3", account.benHosted, 162, { fromAddress: "quinn.ibx@example.com", toAddresses: "ben@ibx.example.com",
                subject: "IBX Quinn to Ben" })
        settle()
        return { p1: eventOfEmail("IBX_P1"), p2: count(CE, { emailMessageId: "IBX_P2" }), p3: eventOfEmail("IBX_P3") }
    },
    then({ p1, p2, p3 }) {
        p1.fromPartyId == party.Pat
        p2 == 0
        p3.fromPartyId == party.Quinn
    },
})

feature("NewMail alerts an account's users once for mail that comes together, and the Inbox recipients of an internal message", {
    when() {
        at(210)
        account.cy = as("Cy", () => {
            const id = call(`${MAIL}.create#EmailAccount`, { accountKindEnumId: "EakHosted", emailAddress: "cy@ibx.example.com", accountName: "Cy",
                    smtpHost: "127.0.0.1", smtpPort: "1", smtpStartTls: "N" }).emailAccountId
            call(`${MAIL}.add#EmailAccountUser`, { emailAccountId: id, userId: user.Ben, permissionEnumId: "EapRead" })
            return id
        })
        // two messages stored together: file#ReceivedEmail, after each commit, alerts once, for the first
        received("IBX_N1", account.cy, 170, { toAddresses: "cy@ibx.example.com", subject: "IBX new one" })
        received("IBX_N2", account.cy, 171, { toAddresses: "cy@ibx.example.com", subject: "IBX new two" })
        settle()
        const first = call(`${COMM}.notify#NewMail`, { emailMessageId: "IBX_N1" })
        const second = call(`${COMM}.notify#NewMail`, { emailMessageId: "IBX_N2" })
        const alone = call(`${COMM}.notify#NewMail`, { emailMessageId: "IBX_N2", coalesceSeconds: 0 })
        const readMail = call(`${COMM}.notify#NewMail`, { emailMessageId: "IBX_E1", coalesceSeconds: 0 })
        const filed = call(`${COMM}.file#ReceivedEmail`, { emailMessageId: "IBX_N1" })
        // Ben takes the team mailbox as Mailbox only; Cy joins it with the Inbox delivery
        as("Ben", () => call("mantle.marketing.ContactListServices.set#ContactListPartyDelivery", { contactListId: mailboxId,
                deliveryEnumId: "CldMailboxOnly" }))
        as("Ada", () => call("mantle.marketing.ContactListServices.add#ContactListParty", { contactListId: mailboxId, partyId: party.Cy }))
        at(211)
        const direct = send("Ben", { toPartyId: party.Ada, ccPartyIdList: [party.Cy], subject: "IBX alert", body: "Look" })
        at(212)
        const post = send("Ada", { contactListId: mailboxId, subject: "IBX alert post", body: "Team" })
        return { first, second, alone, readMail, filed, direct, post }
    },
    then({ first, second, alone, readMail, filed, direct, post }) {
        sorted(first.notifiedUserIds) == sorted([user.Cy, user.Ben])
        first.newCount == 2
        second.notifiedUserIds == []
        sorted(second.coalescedUserIds) == sorted([user.Cy, user.Ben])
        sorted(alone.notifiedUserIds) == sorted([user.Cy, user.Ben])
        alone.newCount == 1
        readMail.notifiedUserIds == []
        sorted(filed.notifiedUserIds) == sorted([user.Cy, user.Ben])
        filed.communicationEventId == null
        filed.failedSteps == []
        sorted(direct.newMailUserIds) == sorted([user.Ada, user.Cy])
        post.newMailUserIds == [user.Cy]
    },
})

feature("a change of a message's unread state publishes the shell counts of its account's users", {
    expect() {
        const change = (eecaOperation, newValues, oldValues) => call("mantle.party.PartyServices.handle#ShellCountsChange", {
            entityName: "moqui.basic.email.EmailMessage", eecaOperation, emailAccountId: account.sales, newValues, oldValues })
        const read = change("update", { isRead: "Y", emailFolderId: "F1" }, { isRead: "N", emailFolderId: "F1" })
        const movedRead = change("update", { isRead: "Y", emailFolderId: "F2" }, { isRead: "Y", emailFolderId: "F1" })
        const createdUnread = change("create", { isRead: "N" }, null)
        const createdRead = change("create", { isRead: "Y" }, null)
        const deletedUnread = change("delete", { isRead: null }, { isRead: "N" })
        read.changed == true
        sorted(read.publishedUserIds) == sorted([user.Ada, user.Ben])
        movedRead.changed == false
        createdUnread.changed == true
        createdRead.changed == false
        deletedUnread.changed == true
    },
})

// The search line over both stores: find#InboxThreads reads searchText once (parse#SearchText), the mail gets the text and
// the internal threads its terms, which find#InternalThreads applies to the parties, dates, subjects and bodies of the
// internal messages and to the thread's state. label: is a label the user put on a message; a name that is not one of
// the user's matches none, and with a - it matches all. What internal messages do not have (larger:, bcc:, a mail-only
// in:) matches none of them, and with a - all of them.
feature("the search operators apply to the internal threads as they do to the mail", {
    when() {
        const old = effectiveTime - 3 * 1440 * minute
        ec.user.setEffectiveTime(old)
        send("Ben", { toPartyId: party.Ada, subject: "IBX old news", body: "From three days ago" })
        at(300)
        send("Ben", { toPartyId: party.Ada, ccPartyIdList: [party.Cy], subject: "IBX zeppelin plans", body: "The airship hangar is ready" })
        at(301)
        const lunch = send("Cy", { toPartyId: party.Ada, subject: "IBX lunch", body: "Zeppelins at noon" })
        at(302)
        const budget = send("Ada", { toPartyId: party.Ben, subject: "IBX budget", body: "The numbers are attached" })
        call("create#mantle.party.communication.CommunicationEventContent", { communicationEventId: budget.communicationEventId,
            contentLocation: "dbresource://ibx/budget.xlsx", description: "budget.xlsx" })
        at(303)
        send("Ben", { toPartyId: party.Ada, communicationEventTypeId: "Comment", subject: "IBX note on the request", body: "See the request" })
        as("Ada", () => call(`${COMM}.set#InternalMessageState`, { rootCommEventId: lunch.communicationEventId, flagged: true }))
        at(305)
        const day = (millis) => ec.l10n.format(String(millis), "yyyy/MM/dd")
        const subjects = (params) => as("Ada", () => inbox(Object.assign({ store: "internal", view: "all" }, params)).threadList.map((row) => row.subject))
        const found = {
            fromWord: subjects({ searchText: "from:ben zeppelin" }),
            word: subjects({ searchText: "zeppelin" }),
            excluded: subjects({ searchText: "zeppelin -hangar" }),
            phrase: subjects({ searchText: '"airship hangar"' }),
            notFrom: subjects({ searchText: "zeppelin -from:ben" }),
            to: subjects({ searchText: "to:cy zeppelin" }),
            cc: subjects({ searchText: "cc:Inboxer subject:zeppelin" }),
            flagged: subjects({ searchText: "is:flagged" }),
            sentAttachment: subjects({ searchText: "in:sent has:attachment" }),
            filename: subjects({ searchText: "in:sent filename:budget" }),
            older: subjects({ searchText: "older_than:2d" }),
            newer: subjects({ searchText: "newer_than:2d subject:\"IBX old\"" }),
            before: subjects({ searchText: `before:${day(old + 1440 * minute)}` }),
            after: subjects({ searchText: `after:${day(old + 1440 * minute)} subject:"IBX old"` }),
            label: subjects({ searchText: "label:news" }),
            notLabel: subjects({ searchText: "-label:news subject:zeppelin" }),
            larger: subjects({ searchText: "larger:1M" }),
            unreadZeppelin: subjects({ searchText: "is:unread zeppelin" }),
            comments: subjects({ view: "comments" }),
            needsReply: subjects({ view: "received", needsReply: true }),
        }
        const unified = as("Ada", () => ({
            sent: inbox({ searchText: "in:sent budget" }),
            trash: inbox({ searchText: "in:trash zeppelin" }),
            mixed: inbox({ searchText: "subject:zeppelin" }),
        }))
        const refused = {
            date: as("Ada", () => errorOf(`${COMM}.find#InboxThreads`, { searchText: "before:someday" })),
        }
        return { found, unified, refused }
    },
    then({ found, unified, refused }) {
        found.fromWord == ["IBX zeppelin plans"]
        found.word == ["IBX lunch", "IBX zeppelin plans"]
        found.excluded == ["IBX lunch"]
        found.phrase == ["IBX zeppelin plans"]
        found.notFrom == ["IBX lunch"]
        found.to == ["IBX zeppelin plans"]
        found.cc.includes("IBX zeppelin plans")
        found.flagged == ["IBX lunch"]
        found.sentAttachment == ["IBX budget"]
        found.filename == ["IBX budget"]
        found.older == ["IBX old news"]
        found.newer == []
        found.before == ["IBX old news"]
        found.after == []
        found.label == []
        found.notLabel == ["IBX zeppelin plans"]
        found.larger == []
        found.unreadZeppelin == ["IBX lunch", "IBX zeppelin plans"]
        found.comments == ["IBX note on the request"]
        found.needsReply == ["IBX old news"]
        unified.sent.storeList == ["email", "internal"]
        unified.sent.threadList.filter((row) => row.store == "internal").map((row) => row.subject) == ["IBX budget"]
        unified.sent.termList == [{ operator: "in", value: "sent", negate: false }]
        unified.trash.storeList == ["email"]
        unified.mixed.threadList.filter((row) => row.store == "internal").map((row) => row.subject) == ["IBX zeppelin plans"]
        refused.date.includes("before:someday needs a date")
    },
})

feature("Needs reply for mail: the Inbox threads a day old or more that are not answered, and none with a reply sent after", {
    when() {
        at(3 * 1440)
        const before = as("Ada", () => inbox({ emailAccountId: account.sales, needsReply: true, pageSize: 100 })).threadList.map(shape)
        // a reply to E2 that waits in the Outbox (no server answers) counts as answered
        as("Ada", () => {
            const draftId = call(`${MAIL}.save#Draft`, { emailAccountId: account.sales, parentEmailMessageId: "IBX_E2", toAddresses: "ibx_e2@outside.example.com",
                body: "<p>Answered</p>" }).emailMessageId
            call(`${MAIL}.send#Draft`, { emailMessageId: draftId })
        })
        const after = as("Ada", () => inbox({ emailAccountId: account.sales, needsReply: true, pageSize: 100 })).threadList.map(shape)
        const paged = []
        as("Ada", () => {
            let cursor = null
            do {
                const page = inbox({ emailAccountId: account.sales, needsReply: true, pageSize: 3, cursor })
                paged.push(...page.threadList.map(shape))
                cursor = page.nextCursor
            } while (cursor && paged.length < 100)
        })
        return { before, after, paged }
    },
    then({ before, after, paged }) {
        before.includes("E2")
        before.includes("E1")
        !after.includes("E2")
        after.length == before.length - 1
        paged == after
    },
})
