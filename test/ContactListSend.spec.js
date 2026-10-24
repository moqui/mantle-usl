// A contact list's marketing send and the unsubscribe flows it leads to (mantle.marketing.ContactListServices
// send#ContactListEmail; mantle.party.ConsentServices create#UnsubscribeToken, check#UnsubscribeToken,
// unsubscribe#ContactListParty, apply#UnsubscribePreferences, send#UnsubscribeVerifyEmail), through the framework's
// MailCapture: the members who get the email and those consent keeps out, one token and one link per message, the
// List-Unsubscribe values (the one-click URL, the page's own as RFC 8058 has it, and the mailto) and the Message-ID kept on the list's send status and the
// token; the RFC 8058 one-click call from the link of a captured email, again changing nothing; the token-route check of
// /u/<token>; an unsubscribe that waits for its confirmation sending the verification email, whose link completes it; the
// reason given kept on the consent rows; resubscribing. The Mantle side of IronStone M11. New spec, no Groovy original.
//
// The List-Unsubscribe headers go out through send#EmailTemplate's extraHeaders, and the mail capture keeps them.
const effectiveTime = Date.now()
const minute = 60000
const at = (minutes) => ec.user.setEffectiveTime(effectiveTime + minutes * minute)
const CONSENT = "mantle.party.ConsentServices"
const SEND = "mantle.marketing.ContactListServices.send#ContactListEmail"
const UNSUBSCRIBE = `${CONSENT}.unsubscribe#ContactListParty`
const CHECK = `${CONSENT}.check#UnsubscribeToken`
const CLP = "mantle.marketing.contact.ContactListParty"
const capture = ec.factory.getTool("MailCapture")
const party = {}
const email = {}
let orgId, newsId, updatesId, sendOut, againOut
const links = {}

spec({
    stepwise: true,
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
        capture.enable()
    },
    cleanupSpec() { capture.reset() },
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
// as the anonymous visitor of the public page: logged out, with authz on
function anonymously(minutes, run) {
    logout()
    ec.artifactExecution.enableAuthz()
    at(minutes)
    try { return run() } finally {
        ec.artifactExecution.disableAuthz()
        login("john.doe")
        at(minutes)
    }
}
const statusOf = (contactListId, first) => {
    const rows = Array.from(ec.entity.find(CLP).condition({ contactListId, partyId: party[first] }).orderBy("-fromDate").list())
    return rows.length ? rows[0].statusId : null
}
const sentTo = (address) => capture.getMessages().filter((mail) => mail.toList.includes(address))
// the token of an unsubscribe link in a body
const tokenIn = (text) => { const found = /\/u\/([A-Za-z0-9_-]{16,128})/.exec(String(text || "")); return found ? found[1] : null }

feature("an organization's newsletter, a list that requires unsubscribe confirmation, the members and their consent, a mail server and templates", {
    when() {
        at(1)
        orgId = call("mantle.party.PartyServices.create#Organization", { organizationName: "Sendspec Co" }).partyId
        for (const first of ["Ann", "Ben", "Cal", "Dee", "Eve", "Fay", "Gus"]) {
            party[first] = call("mantle.party.PartyServices.create#Person", { firstName: first, lastName: "Sendspec" }).partyId
            if (first === "Eve") continue
            email[first] = call("mantle.party.ContactServices.create#EmailAddress", { partyId: party[first],
                emailAddress: `${first.toLowerCase()}.sendspec@example.com`, contactMechPurposeId: "EmailPrimary" }).contactMechId
        }
        // Fay prefers a second address for the list; Gus shares Ann's address
        email.Fay2 = call("mantle.party.ContactServices.create#EmailAddress", { partyId: party.Fay, emailAddress: "fay.lists@example.com",
            contactMechPurposeId: "EmailOther" }).contactMechId
        email.Gus = call("mantle.party.ContactServices.create#EmailAddress", { partyId: party.Gus, emailAddress: "ann.sendspec@example.com",
            contactMechPurposeId: "EmailPrimary" }).contactMechId
        call("create#moqui.basic.email.EmailServer", { emailServerId: "SENDSPEC_SMTP", smtpHost: "127.0.0.1", smtpPort: "1", smtpStartTls: "N" })
        call("create#moqui.basic.email.EmailTemplate", { emailTemplateId: "SENDSPEC_NEWS", description: "Sendspec News", emailServerId: "SENDSPEC_SMTP",
            fromAddress: "news@sendspec.example.com", fromName: "Sendspec Co", subject: "Sendspec News for ${firstName}" })
        call("create#moqui.basic.email.EmailTemplate", { emailTemplateId: "SENDSPEC_VERIFY", description: "Sendspec unsubscribe confirmation",
            emailServerId: "SENDSPEC_SMTP", fromAddress: "news@sendspec.example.com", subject: "Confirm: ${contactListName}" })
        newsId = call("create#mantle.marketing.contact.ContactList", { contactListTypeEnumId: "NEWSLETTER", contactListName: "Sendspec News",
            ownerPartyId: orgId, contactMechTypeEnumId: "CmtEmailAddress" }).contactListId
        updatesId = call("create#mantle.marketing.contact.ContactList", { contactListTypeEnumId: "ANNOUNCEMENT", contactListName: "Sendspec Updates",
            ownerPartyId: orgId, contactMechTypeEnumId: "CmtEmailAddress" }).contactListId
        call("create#mantle.marketing.contact.ContactListEmail", { contactListId: newsId, emailTypeEnumId: "CONT_EMAIL_TEMPLATE",
            fromDate: ec.user.nowTimestamp, emailTemplateId: "SENDSPEC_NEWS" })
        call("create#mantle.marketing.contact.ContactListEmail", { contactListId: updatesId, emailTypeEnumId: "CONT_UNSUB_VER",
            fromDate: ec.user.nowTimestamp, emailTemplateId: "SENDSPEC_VERIFY" })
        const join = (contactListId, first, statusId, preferred) => call("create#mantle.marketing.contact.ContactListParty", { contactListId,
            partyId: party[first], fromDate: ec.user.nowTimestamp, statusId, preferredContactMechId: preferred === undefined ? (email[first] || null) : preferred })
        join(newsId, "Ann", "CLPT_ACCEPTED")
        join(newsId, "Ben", "CLPT_ACCEPTED")
        join(newsId, "Cal", "CLPT_UNSUBSCRIBED")
        join(newsId, "Dee", "CLPT_PENDING")
        join(newsId, "Eve", "CLPT_ACCEPTED", null)
        join(newsId, "Fay", "CLPT_IN_USE", email.Fay2)
        // Gus joins after Ann, so their shared address goes to Ann
        at(1.5)
        join(newsId, "Gus", "CLPT_ACCEPTED")
        join(updatesId, "Ann", "CLPT_ACCEPTED")
        // Ben withdrew marketing email on his address: allowSolicitation N, so the send leaves him out
        call(`${CONSENT}.store#PartyConsent`, { partyId: party.Ben, contactMechId: email.Ben, purposeEnumId: "PcpMarketingEmail",
            statusId: "PconWithdrawn", sourceEnumId: "PcsForm" })
        return {}
    },
    then() {
        Object.keys(party).length == 7
        statusOf(newsId, "Fay") == "CLPT_IN_USE"
    },
})

feature("send#ContactListEmail: each subscribed member once, the others left out with the reason, one link and token per message", {
    when() {
        at(2)
        capture.clear()
        sendOut = call(SEND, { contactListId: newsId, subject: "October", baseUrl: "https://news.sendspec.example.com/",
            unsubscribeMailto: "leave@sendspec.example.com", body: "<p>Hello ${firstName}, the October news.</p>",
            bodyText: "Hello ${firstName}, the October news." })
        const messages = capture.getMessages()
        const comm = ec.entity.find("mantle.party.communication.CommunicationEvent").condition("communicationEventId", sendOut.communicationEventId).one()
        const statuses = Array.from(ec.entity.find("mantle.marketing.contact.ContactListCommStatus").condition("communicationEventId", sendOut.communicationEventId).list())
        const tokens = Array.from(ec.entity.find("mantle.marketing.contact.ContactListToken").condition("communicationEventId", sendOut.communicationEventId).list())
        return { messages, comm, statuses, tokens }
    },
    then({ messages, comm, statuses, tokens }) {
        sendOut.sentCount == 2
        sendOut.failedPartyIdList.length == 0
        sendOut.recipientList.map((row) => row.partyId).sort() == [party.Ann, party.Fay].sort()
        sendOut.skippedList.find((row) => row.partyId === party.Ben).reason == "does not allow solicitation"
        sendOut.skippedList.find((row) => row.partyId === party.Eve).reason == "no email address"
        sendOut.skippedList.find((row) => row.partyId === party.Gus).reason == "address already sent to"
        sendOut.skippedList.every((row) => row.partyId !== party.Cal && row.partyId !== party.Dee)
        messages.length == 2
        sentTo("ann.sendspec@example.com").length == 1
        sentTo("fay.lists@example.com").length == 1
        sentTo("ann.sendspec@example.com")[0].subject == "Sendspec News for Ann"
        sentTo("ann.sendspec@example.com")[0].body.includes("Hello Ann, the October news.")
        sentTo("ann.sendspec@example.com")[0].body.includes("https://news.sendspec.example.com/u/")
        sentTo("ann.sendspec@example.com")[0].body.includes("you subscribed to Sendspec News")
        sentTo("ann.sendspec@example.com")[0].bodyText.includes("Unsubscribe: https://news.sendspec.example.com/u/")
        tokenIn(sentTo("ann.sendspec@example.com")[0].body) != tokenIn(sentTo("fay.lists@example.com")[0].body)
        comm.contactListId == newsId
        comm.communicationEventTypeId == "Email"
        comm.fromPartyId == orgId
        comm.subject == "October"
        statuses.length == 2
        statuses.every((row) => row.statusId == "CeSent" && row.messageId)
        statuses.map((row) => row.messageId).sort() == messages.map((mail) => mail.messageId).sort()
        statuses.find((row) => row.partyId === party.Fay).contactMechId == email.Fay2
        tokens.length == 2
        tokens.every((row) => statuses.some((status) => status.messageId === row.messageId && status.partyId === row.partyId))
        tokens.every((row) => row.tokenHash !== tokenIn(sentTo("ann.sendspec@example.com")[0].body))
    },
})

feature("the List-Unsubscribe values of each message: the one-click URL of its token (the page's URL itself), then the mailto with the token", {
    expect() {
        const ann = sendOut.recipientList.find((row) => row.partyId === party.Ann)
        const token = tokenIn(sentTo("ann.sendspec@example.com")[0].body)
        links.ann = token
        links.fay = tokenIn(sentTo("fay.lists@example.com")[0].body)
        ann.unsubscribeUrl == `https://news.sendspec.example.com/u/${token}`
        ann.listUnsubscribeHeaders["List-Unsubscribe"] ==
            `<https://news.sendspec.example.com/u/${token}>, <mailto:leave@sendspec.example.com?subject=unsubscribe%20${token}>`
        ann.listUnsubscribeHeaders["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
        ann.messageId == sentTo("ann.sendspec@example.com")[0].messageId
    },
})

feature("the List-Unsubscribe and List-Unsubscribe-Post headers go out with the message", {
    expect() {
        const mail = sentTo("ann.sendspec@example.com")[0]
        mail.headers["List-Unsubscribe"] == sendOut.recipientList.find((row) => row.partyId === party.Ann).listUnsubscribeHeaders["List-Unsubscribe"]
        mail.headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    },
})

feature("a mailto that is not one plain address is left out of List-Unsubscribe", {
    expect() {
        const out = call(`${CONSENT}.create#UnsubscribeToken`, { contactListId: newsId, partyId: party.Ann, baseUrl: "https://news.sendspec.example.com",
            mailtoAddress: "leave@sendspec.example.com, list@sendspec.example.com" })
        out.listUnsubscribeHeaders["List-Unsubscribe"] == `<https://news.sendspec.example.com/u/${out.token}>`
        out.oneClickUrl == out.unsubscribeUrl
    },
})

feature("check#UnsubscribeToken, the /u/ route's check: a current token with the organization and list, an ended one only as ended, an unknown one refused", {
    when() {
        const ended = call(`${CONSENT}.create#UnsubscribeToken`, { contactListId: newsId, partyId: party.Ann, thruDate: new Date(effectiveTime + 3 * minute) }).token
        return anonymously(4, () => ({ current: call(CHECK, { token: links.ann, routeName: "u" }), ended: call(CHECK, { token: ended, routeName: "u" }),
            unknown: call(CHECK, { token: "B".repeat(32), routeName: "u" }), malformed: call(CHECK, { token: "bad token", routeName: "u" }) }))
    },
    then({ current, ended, unknown, malformed }) {
        current.valid
        current.routeContext.expired == false
        current.routeContext.organizationName == "Sendspec Co"
        current.routeContext.contactListName == "Sendspec News"
        current.routeContext.partyId == null
        ended.valid
        ended.routeContext.expired == true
        ended.routeContext.organizationName == null
        !unknown.valid
        unknown.routeContext == null
        !malformed.valid
    },
})

feature("the one-click call from the link of a captured email unsubscribes at once with the email link as evidence; again changes nothing", {
    when() {
        const out = anonymously(5, () => ({ first: call(UNSUBSCRIBE, { token: links.fay, listUnsubscribe: "One-Click" }),
            again: call(UNSUBSCRIBE, { token: links.fay, listUnsubscribe: "One-Click" }) }))
        const rows = Array.from(ec.entity.find("mantle.party.PartyConsent").condition({ partyId: party.Fay, contactListId: newsId }).list())
        return Object.assign(out, { status: statusOf(newsId, "Fay"), rows })
    },
    then({ first, again, status, rows }) {
        first.statusId == "CLPT_UNSUBSCRIBED"
        first.changedList.length == 1
        again.changedList.length == 0
        status == "CLPT_UNSUBSCRIBED"
        rows.length == 1
        rows[0].statusId == "PconWithdrawn"
        rows[0].sourceEnumId == "PcsEmailLink"
        rows[0].contactMechId == email.Fay2
        rows[0].evidenceText.includes("One-click unsubscribe (RFC 8058) of message")
    },
})

feature("the next send leaves out the member who unsubscribed", {
    when() {
        at(6)
        capture.clear()
        againOut = call(SEND, { contactListId: newsId, baseUrl: "https://news.sendspec.example.com", bodyText: "November." })
        return { messages: capture.getMessages() }
    },
    then({ messages }) {
        againOut.sentCount == 1
        messages.length == 1
        messages[0].toList == ["ann.sendspec@example.com"]
        againOut.recipientList[0].listUnsubscribeHeaders["List-Unsubscribe"] == `<${againOut.recipientList[0].unsubscribeUrl}>`
    },
})

feature("an unsubscribe by the page's link from a list that requires confirmation waits, with the reason kept, and sends the verification email", {
    when() {
        at(7)
        const pageToken = call(`${CONSENT}.create#UnsubscribeToken`, { contactListId: updatesId, partyId: party.Ann,
            baseUrl: "https://news.sendspec.example.com" }).token
        links.updates = pageToken
        capture.clear()
        const out = anonymously(8, () => call(UNSUBSCRIBE, { token: pageToken, reasonText: "Too many emails", baseUrl: "https://news.sendspec.example.com" }))
        const messages = capture.getMessages()
        const row = Array.from(ec.entity.find(CLP).condition({ contactListId: updatesId, partyId: party.Ann }).orderBy("-fromDate").list())[0]
        const consent = Array.from(ec.entity.find("mantle.party.PartyConsent").condition({ partyId: party.Ann, contactListId: updatesId }).list())
        return { out, messages, row, consent }
    },
    then({ out, messages, row, consent }) {
        out.statusId == "CLPT_UNSUBS_PENDING"
        out.unsubscribePending
        out.verifyEmailSent
        row.statusId == "CLPT_UNSUBS_PENDING"
        row.optInVerifyCode.length == 20
        messages.length == 1
        messages[0].toList == ["ann.sendspec@example.com"]
        messages[0].subject == "Confirm: Sendspec Updates"
        messages[0].body.includes(`?verifyCode=${row.optInVerifyCode}`)
        tokenIn(messages[0].body) != links.updates
        consent.length == 1
        consent[0].statusId == "PconWithdrawn"
        consent[0].comments == "Too many emails"
        consent[0].evidenceText.includes("pending confirmation")
    },
})

feature("the verification email's link completes the unsubscribe, waiting until then", {
    when() {
        const mail = capture.last()
        const verifyToken = tokenIn(mail.body)
        const code = /verifyCode=([A-Za-z0-9_-]+)/.exec(mail.body)[1]
        const waiting = statusOf(updatesId, "Ann")
        const done = anonymously(10, () => call(UNSUBSCRIBE, { token: verifyToken, verifyCode: code }))
        return { waiting, done, status: statusOf(updatesId, "Ann"), sentAfter: capture.count() }
    },
    then({ waiting, done, status, sentAfter }) {
        waiting == "CLPT_UNSUBS_PENDING"
        done.statusId == "CLPT_UNSUBSCRIBED"
        status == "CLPT_UNSUBSCRIBED"
        sentAfter == 1
    },
})

feature("resubscribing from the page (apply#UnsubscribePreferences) undoes the unsubscribe with a grant from the email link", {
    when() {
        const out = anonymously(11, () => call(`${CONSENT}.apply#UnsubscribePreferences`, { token: links.fay, listChoices: [{ contactListId: newsId, subscribed: true }] }))
        const rows = Array.from(ec.entity.find("mantle.party.PartyConsent").condition({ partyId: party.Fay, contactListId: newsId }).list())
                .sort((a, b) => Number(b.consentDate) - Number(a.consentDate) || (String(b.partyConsentId) > String(a.partyConsentId) ? 1 : -1))
        return { out, rows, status: statusOf(newsId, "Fay") }
    },
    then({ out, rows, status }) {
        out.changedList.length == 1
        status == "CLPT_ACCEPTED"
        rows[0].statusId == "PconGranted"
        rows[0].sourceEnumId == "PcsEmailLink"
    },
})

feature("an email to the List-Unsubscribe mailto with the token in its subject unsubscribes at once; any other subject or token does nothing", {
    when() {
        const PROCESS = `${CONSENT}.process#UnsubscribeEmail`
        const out = anonymously(12, () => ({
            mail: call(PROCESS, { fields: { subject: `unsubscribe ${links.fay}`, from: "Fay Sendspec <fay.lists@example.com>" } }),
            other: call(PROCESS, { fields: { subject: "Re: your newsletter", from: "fay.lists@example.com" } }),
            unknown: call(PROCESS, { fields: { subject: `unsubscribe ${"C".repeat(32)}`, from: "someone@example.com" } }),
        }))
        const rows = Array.from(ec.entity.find("mantle.party.PartyConsent").condition({ partyId: party.Fay, contactListId: newsId }).list())
                .sort((a, b) => Number(b.consentDate) - Number(a.consentDate) || (String(b.partyConsentId) > String(a.partyConsentId) ? 1 : -1))
        return Object.assign(out, { status: statusOf(newsId, "Fay"), rows })
    },
    then({ mail, other, unknown, status, rows }) {
        mail.unsubscribed
        !other.unsubscribed
        !unknown.unsubscribed
        status == "CLPT_UNSUBSCRIBED"
        rows[0].statusId == "PconWithdrawn"
        rows[0].evidenceText.includes("Unsubscribe by email (List-Unsubscribe mailto) from Fay Sendspec fay.lists@example.com")
    },
})

feature("a list without a template is refused before anything is sent; with no site address given, the links use the webapp's, never localhost", {
    allowMessageErrors: true,
    when() {
        capture.clear()
        const refused = { noTemplate: errorOf(SEND, { contactListId: updatesId, baseUrl: "https://news.sendspec.example.com" }),
            sentRefused: capture.count() }
        // no baseUrl and no web host name on the template: the conf webapp's address (P8-08), unless it is localhost (the
        // dev conf's), which a whole list would get as a dead link, so the send is refused
        const root = String(ec.web ? ec.web.getWebappRootUrl(true, null) || "" : "").replace(/\/$/, "")
        const local = /^https?:\/\/(localhost|127\.0\.0\.1)([:\/]|$)/i.test(root)
        const noBase = local ? errorOf(SEND, { contactListId: newsId, bodyText: "December." }) : call(SEND, { contactListId: newsId, bodyText: "December." })
        return Object.assign(refused, { root, local, noBase, sent: capture.count() })
    },
    then({ noTemplate, sentRefused, root, local, noBase, sent }) {
        noTemplate.includes("has no email template")
        sentRefused == 0
        root.startsWith("http")
        local ? String(noBase).includes("need the site address") : noBase.recipientList.length > 0
        local || noBase.recipientList.every((recipient) => String(recipient.unsubscribeUrl).startsWith(root + "/u/"))
        sent == (local ? 0 : noBase.recipientList.length)
    },
})

feature("with no baseUrl and no web host name on the template the links start with its email server's web base URL", {
    when() {
        capture.clear()
        call("update#moqui.basic.email.EmailServer", { emailServerId: "SENDSPEC_SMTP", webBaseUrl: "https://mail.sendspec.example.com/" })
        try {
            const out = call(SEND, { contactListId: newsId, bodyText: "December." })
            return { out, messages: capture.getMessages() }
        } finally {
            call("update#moqui.basic.email.EmailServer", { emailServerId: "SENDSPEC_SMTP", webBaseUrl: null })
        }
    },
    then({ out, messages }) {
        out.sentCount >= 1
        out.recipientList.every((recipient) => recipient.unsubscribeUrl.startsWith("https://mail.sendspec.example.com/u/"))
        messages[0].bodyText.includes("Unsubscribe: https://mail.sendspec.example.com/u/")
    },
})
