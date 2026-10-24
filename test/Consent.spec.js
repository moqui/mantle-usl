// Consent and unsubscribe (mantle.party.ConsentServices): the PartyConsent history and the current state of each
// purpose, allowSolicitation following the marketing consent of an address, unsubscribing from one list and from all
// marketing email (statuses, withdrawals, nothing more the second time), a list that requires confirmation, subscribing
// again, the unsubscribe tokens of the public page /u/<token> used by an anonymous visitor (resolve, preferences, the
// RFC 8058 one-click POST) and refused when unknown or expired, find#Consents with its filters and CSV export, mailboxes
// left out of consent, and merge#Parties moving the consent rows and tokens: the Mantle side of IronStone M11. New spec,
// no Groovy original.
const effectiveTime = Date.now()
const minute = 60000
// each step at its own minute, so the consent history has an order and member rows (keyed by fromDate) do not collide
const at = (minutes) => ec.user.setEffectiveTime(effectiveTime + minutes * minute)
const CONSENT = "mantle.party.ConsentServices"
const STORE = `${CONSENT}.store#PartyConsent`
const UNSUBSCRIBE = `${CONSENT}.unsubscribe#ContactListParty`
const RESOLVE = `${CONSENT}.resolve#UnsubscribeToken`
const APPLY = `${CONSENT}.apply#UnsubscribePreferences`
const CREATE_TOKEN = `${CONSENT}.create#UnsubscribeToken`
const PC = "mantle.party.PartyConsent"
const CLP = "mantle.marketing.contact.ContactListParty"
const TOKEN = "mantle.marketing.contact.ContactListToken"
const party = {}
const email = {}
const list = {}
const token = {}
let orgId, otherOrgId, coraPhoneId, mailboxId

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
const toMillis = (value) => value == null ? null : (typeof value === "number" ? value : Number(value))
const newestFirst = (a, b) => (toMillis(b.consentDate) - toMillis(a.consentDate)) ||
        (String(b.partyConsentId).length - String(a.partyConsentId).length) || (String(b.partyConsentId) > String(a.partyConsentId) ? 1 : -1)
const statusIn = (contactListId, partyId) => {
    const rows = Array.from(ec.entity.find(CLP).condition({ contactListId, partyId }).orderBy("-fromDate").list())
    return rows.length ? rows[0].statusId : null
}
const statusOf = (key, first) => statusIn(list[key], party[first])
const memberRow = (key, first) => Array.from(ec.entity.find(CLP).condition({ contactListId: list[key], partyId: party[first] }).orderBy("-fromDate").list())[0]
const consentRows = (first, conditions) => {
    const rows = Array.from(ec.entity.find(PC).condition(Object.assign({ partyId: party[first] }, conditions || {})).list())
    rows.sort(newestFirst)
    return rows
}
const solicitation = (first, contactMechId) => Array.from(ec.entity.find("mantle.party.contact.PartyContactMech")
        .condition({ partyId: party[first], contactMechId }).condition(ec.entity.conditionFactory.makeConditionDate("fromDate", "thruDate", null))
        .list()).map((row) => row.allowSolicitation ?? null)
const ids = (rows) => rows.map((row) => row.contactListId).sort()
const urlSafe = /^[A-Za-z0-9_-]+$/
const findIds = (params) => call(`${CONSENT}.find#Consents`, Object.assign({ text: "consentspec" }, params || {})).consentList.map((row) => row.partyId)

feature("contacts, an organization's lists, one requiring unsubscribe confirmation, a mailbox and the members", {
    when() {
        at(1)
        orgId = call("mantle.party.PartyServices.create#Organization", { organizationName: "Consent Co" }).partyId
        otherOrgId = call("mantle.party.PartyServices.create#Organization", { organizationName: "Other Consent Co" }).partyId
        for (const first of ["Cora", "Dale", "Evan", "Fay"]) {
            party[first] = call("mantle.party.PartyServices.create#Person", { firstName: first, lastName: "Consentspec" }).partyId
            email[first] = call("mantle.party.ContactServices.create#EmailAddress", { partyId: party[first],
                emailAddress: `${first.toLowerCase()}.consentspec@example.com`, contactMechPurposeId: "EmailPrimary" }).contactMechId
        }
        coraPhoneId = call("mantle.party.ContactServices.create#TelecomNumber", { partyId: party.Cora, areaCode: "801", contactNumber: "5550101",
            contactMechPurposeId: "PhoneMobile" }).contactMechId
        const makeList = (key, contactListTypeEnumId, contactListName, ownerPartyId) => {
            list[key] = call("create#mantle.marketing.contact.ContactList", { contactListTypeEnumId, contactListName, ownerPartyId,
                contactMechTypeEnumId: "CmtEmailAddress" }).contactListId
        }
        makeList("news", "NEWSLETTER", "Consent News", orgId)
        makeList("promo", "MARKETING", "Consent Offers", orgId)
        makeList("confirm", "MARKETING", "Consent Confirmed", orgId)
        makeList("other", "NEWSLETTER", "Other News", otherOrgId)
        call("create#mantle.marketing.contact.ContactListEmail", { contactListId: list.confirm, emailTypeEnumId: "CONT_UNSUB_VER",
            fromDate: ec.user.nowTimestamp })
        mailboxId = call("mantle.marketing.ContactListServices.create#ContactList", { contactListTypeEnumId: "MAILBOX",
            contactListName: "Consent team room", memberPartyIdList: [party.Cora, party.Dale] }).contactListId
        const join = (key, first) => call("create#mantle.marketing.contact.ContactListParty", { contactListId: list[key], partyId: party[first],
            fromDate: ec.user.nowTimestamp, statusId: "CLPT_ACCEPTED", preferredContactMechId: email[first] })
        for (const key of ["news", "promo", "confirm", "other"]) join(key, "Cora")
        join("news", "Dale")
        join("promo", "Dale")
        join("news", "Evan")
        return {}
    },
    then() {
        Object.keys(party).length == 4
        statusOf("confirm", "Cora") == "CLPT_ACCEPTED"
        statusIn(mailboxId, party.Dale) == "CLPT_ACCEPTED"
    },
})

feature("store#PartyConsent keeps the history; the current state of a purpose is its latest row", {
    when() {
        at(2)
        const first = call(STORE, { partyId: party.Cora, contactMechId: email.Cora, purposeEnumId: "PcpMarketingEmail", statusId: "PconGranted",
            sourceEnumId: "PcsForm", evidenceText: "Signup form: Yes, send me offers" })
        at(3)
        const second = call(STORE, { partyId: party.Cora, contactMechId: email.Cora, purposeEnumId: "PcpMarketingEmail", statusId: "PconWithdrawn" })
        at(4)
        const third = call(STORE, { partyId: party.Cora, contactMechId: email.Cora, purposeEnumId: "PcpMarketingEmail", statusId: "PconGranted",
            sourceEnumId: "PcsForm", evidenceText: "Preferences form" })
        call(STORE, { partyId: party.Cora, purposeEnumId: "PcpDataProcessing", statusId: "PconGranted", sourceEnumId: "PcsForm" })
        const notTheirs = errorOf(STORE, { partyId: party.Cora, contactMechId: email.Dale, purposeEnumId: "PcpMarketingEmail", statusId: "PconGranted" })
        const state = call(`${CONSENT}.get#PartyConsentState`, { partyId: party.Cora })
        const history = call(`${CONSENT}.get#PartyConsentHistory`, { partyId: party.Cora, purposeEnumId: "PcpMarketingEmail" })
        const page = call(`${CONSENT}.get#PartyConsentHistory`, { partyId: party.Cora, pageSize: 2, pageIndex: 1 })
        return { first, second, third, notTheirs, state, history, page }
    },
    then({ first, second, third, notTheirs, state, history, page }) {
        first.partyConsentId != null
        first.allowSolicitation == "Y"
        second.allowSolicitation == "N"
        third.allowSolicitation == "Y"
        notTheirs.includes("is not party")
        consentRows("Cora", { purposeEnumId: "PcpMarketingEmail" }).length == 3
        history.historyListCount == 3
        history.historyList.map((row) => row.statusId) == ["PconGranted", "PconWithdrawn", "PconGranted"]
        history.historyList[0].partyConsentId == third.partyConsentId
        history.historyList[0].sourceDescription == "Form"
        history.historyList[0].statusDescription == "Granted"
        history.historyList[0].purposeDescription == "Marketing Email"
        history.historyList[1].sourceEnumId == "PcsStaff"
        history.historyList[0].addressText == "cora.consentspec@example.com"
        history.historyList[0].userName != null
        history.historyList[2].evidenceText.includes("Signup form")
        page.historyListCount == 4
        page.historyList.length == 2
        page.historyListPageMaxIndex == 1
        state.grantedPurposeEnumIds.slice().sort() == ["PcpDataProcessing", "PcpMarketingEmail"]
        state.consentList.length == 2
        state.consentList.find((consent) => consent.purposeEnumId === "PcpMarketingEmail").partyConsentId == third.partyConsentId
        state.consentList.find((consent) => consent.purposeEnumId === "PcpDataProcessing").contactMechId == null
        state.addressList.find((address) => address.contactMechId === email.Cora).allowSolicitation == "Y"
        state.addressList.find((address) => address.contactMechId === coraPhoneId).addressText == "801 555-0101"
        ids(state.listList) == [list.news, list.promo, list.confirm, list.other].sort()
    },
})

feature("allowSolicitation of an address follows its marketing purposes; data processing and list rows leave it", {
    when() {
        at(5)
        call(STORE, { partyId: party.Cora, contactMechId: coraPhoneId, purposeEnumId: "PcpSms", statusId: "PconGranted", sourceEnumId: "PcsForm" })
        const afterSms = solicitation("Cora", coraPhoneId)
        call(STORE, { partyId: party.Cora, contactMechId: coraPhoneId, purposeEnumId: "PcpPhone", statusId: "PconWithdrawn" })
        const afterPhoneWithdrawn = solicitation("Cora", coraPhoneId)
        call(STORE, { partyId: party.Cora, contactMechId: coraPhoneId, purposeEnumId: "PcpSms", statusId: "PconWithdrawn" })
        const afterSmsWithdrawn = solicitation("Cora", coraPhoneId)
        call(STORE, { partyId: party.Cora, contactMechId: email.Cora, purposeEnumId: "PcpDataProcessing", statusId: "PconWithdrawn" })
        const afterDataProcessing = solicitation("Cora", email.Cora)
        // the subscription history of a list does not change the address's own consent
        call(STORE, { partyId: party.Cora, contactMechId: email.Cora, purposeEnumId: "PcpMarketingEmail", statusId: "PconWithdrawn",
            contactListId: list.other, evidenceText: "asked by phone" })
        const afterListRow = solicitation("Cora", email.Cora)
        call(STORE, { partyId: party.Cora, contactMechId: email.Cora, purposeEnumId: "PcpMarketingEmail", statusId: "PconGranted",
            contactListId: list.other, evidenceText: "changed her mind" })
        const state = call(`${CONSENT}.get#PartyConsentState`, { partyId: party.Cora })
        return { afterSms, afterPhoneWithdrawn, afterSmsWithdrawn, afterDataProcessing, afterListRow, state }
    },
    then({ afterSms, afterPhoneWithdrawn, afterSmsWithdrawn, afterDataProcessing, afterListRow, state }) {
        afterSms == ["Y"]
        afterPhoneWithdrawn == ["Y"]
        afterSmsWithdrawn == ["N"]
        afterDataProcessing == ["Y"]
        afterListRow == ["Y"]
        state.addressList.find((address) => address.contactMechId === coraPhoneId).allowSolicitation == "N"
        state.grantedPurposeEnumIds.slice().sort() == ["PcpDataProcessing", "PcpMarketingEmail"]
        state.listList.find((entry) => entry.contactListId === list.other).lastConsentStatusId == "PconGranted"
    },
})

feature("unsubscribe#ContactListParty by staff: CLPT_UNSUBSCRIBED and a withdrawal for the list, then nothing more", {
    when() {
        at(6)
        const out = call(UNSUBSCRIBE, { contactListId: list.promo, partyId: party.Cora })
        const again = call(UNSUBSCRIBE, { contactListId: list.promo, partyId: party.Cora })
        return { out, again, status: statusOf("promo", "Cora"), rows: consentRows("Cora", { contactListId: list.promo }),
            emailFlags: solicitation("Cora", email.Cora) }
    },
    then({ out, again, status, rows, emailFlags }) {
        out.statusId == "CLPT_UNSUBSCRIBED"
        out.changedList.length == 1
        out.changedList[0].previousStatusId == "CLPT_ACCEPTED"
        again.changedList.length == 0
        again.unchangedContactListIds == [list.promo]
        again.statusId == "CLPT_UNSUBSCRIBED"
        status == "CLPT_UNSUBSCRIBED"
        rows.length == 1
        rows[0].statusId == "PconWithdrawn"
        rows[0].sourceEnumId == "PcsStaff"
        rows[0].contactMechId == email.Cora
        rows[0].purposeEnumId == "PcpMarketingEmail"
        emailFlags == ["Y"]
    },
})

feature("a list that requires confirmation goes to CLPT_UNSUBS_PENDING; the verification code completes it", {
    when() {
        at(7)
        const out = call(UNSUBSCRIBE, { contactListId: list.confirm, partyId: party.Cora })
        const code = memberRow("confirm", "Cora").optInVerifyCode
        const again = call(UNSUBSCRIBE, { contactListId: list.confirm, partyId: party.Cora })
        const codeAgain = memberRow("confirm", "Cora").optInVerifyCode
        const wrong = errorOf(UNSUBSCRIBE, { contactListId: list.confirm, partyId: party.Cora, verifyCode: "not-the-code" })
        const confirmed = call(UNSUBSCRIBE, { contactListId: list.confirm, partyId: party.Cora, verifyCode: code })
        return { out, code, again, codeAgain, wrong, confirmed, status: statusOf("confirm", "Cora"), rows: consentRows("Cora", { contactListId: list.confirm }) }
    },
    then({ out, code, again, codeAgain, wrong, confirmed, status, rows }) {
        out.statusId == "CLPT_UNSUBS_PENDING"
        out.unsubscribePending == true
        code != null
        again.changedList.length == 0
        codeAgain == code
        wrong.includes("does not match")
        confirmed.statusId == "CLPT_UNSUBSCRIBED"
        confirmed.unsubscribePending == false
        status == "CLPT_UNSUBSCRIBED"
        rows.length == 1
        rows[0].statusId == "PconWithdrawn"
        rows[0].evidenceText.includes("pending confirmation")
    },
})

feature("subscribe#ContactListParty subscribes again with a grant for the list; a mailbox is joined, not subscribed to", {
    when() {
        at(8)
        const out = call(`${CONSENT}.subscribe#ContactListParty`, { contactListId: list.promo, partyId: party.Cora })
        const again = call(`${CONSENT}.subscribe#ContactListParty`, { contactListId: list.promo, partyId: party.Cora })
        return { out, again, status: statusOf("promo", "Cora"), rows: consentRows("Cora", { contactListId: list.promo }) }
    },
    then({ out, again, status, rows }) {
        out.statusId == "CLPT_ACCEPTED"
        out.previousStatusId == "CLPT_UNSUBSCRIBED"
        out.changed == true
        again.changed == false
        status == "CLPT_ACCEPTED"
        rows.length == 2
        rows[0].statusId == "PconGranted"
        rows[0].sourceEnumId == "PcsStaff"
    },
})

feature("unsubscribe from all marketing email: each list of email, the address withdrawn, a mailbox untouched; then nothing more", {
    when() {
        at(9)
        const out = call(UNSUBSCRIBE, { partyId: party.Dale, allMarketing: true })
        const again = call(UNSUBSCRIBE, { partyId: party.Dale, allMarketing: true })
        return { out, again, news: statusOf("news", "Dale"), promo: statusOf("promo", "Dale"), mailbox: statusIn(mailboxId, party.Dale),
            addressRows: consentRows("Dale", { contactListId: null }), listRowCount: consentRows("Dale").filter((row) => row.contactListId).length,
            flags: solicitation("Dale", email.Dale) }
    },
    then({ out, again, news, promo, mailbox, addressRows, listRowCount, flags }) {
        ids(out.changedList) == [list.news, list.promo].sort()
        out.marketingWithdrawn == true
        out.failedContactListIds.length == 0
        again.changedList.length == 0
        again.unchangedContactListIds.length == 2
        again.marketingWithdrawn == false
        news == "CLPT_UNSUBSCRIBED"
        promo == "CLPT_UNSUBSCRIBED"
        mailbox == "CLPT_ACCEPTED"
        addressRows.length == 1
        addressRows[0].contactMechId == email.Dale
        addressRows[0].statusId == "PconWithdrawn"
        addressRows[0].purposeEnumId == "PcpMarketingEmail"
        listRowCount == 2
        flags == ["N"]
    },
})

feature("create#UnsubscribeToken: a random token given once with its hash kept, the link and the List-Unsubscribe headers", {
    when() {
        at(10)
        const communicationEventId = call("create#mantle.party.communication.CommunicationEvent", { communicationEventTypeId: "Email",
            statusId: "CeSent", fromPartyId: orgId, toPartyId: party.Cora, subject: "Consent News, October", entryDate: ec.user.nowTimestamp }).communicationEventId
        call("create#mantle.marketing.contact.ContactListCommStatus", { contactListId: list.news, communicationEventId, contactMechId: email.Cora,
            partyId: party.Cora, messageId: "<consent-news-1@example.com>" })
        const news = call(CREATE_TOKEN, { messageId: "<consent-news-1@example.com>", baseUrl: "https://shop.example.com/" })
        token.news = news.token
        token.promo = call(CREATE_TOKEN, { contactListId: list.promo, partyId: party.Cora, baseUrl: "https://shop.example.com" }).token
        token.confirm = call(CREATE_TOKEN, { contactListId: list.confirm, partyId: party.Cora }).token
        token.expired = call(CREATE_TOKEN, { contactListId: list.news, partyId: party.Cora, thruDate: new Date(effectiveTime + 11 * minute) }).token
        const row = ec.entity.find(TOKEN).condition("contactListTokenId", news.contactListTokenId).one()
        const plainCount = ec.entity.find(TOKEN).condition("tokenHash", news.token).count()
        return { news, communicationEventId, row, plainCount }
    },
    then({ news, communicationEventId, row, plainCount }) {
        news.token.length == 32
        urlSafe.test(news.token)
        news.unsubscribeUrl == "https://shop.example.com/u/" + news.token
        // RFC 8058: the one-click POST goes to the page's own URL
        news.oneClickUrl == "https://shop.example.com/u/" + news.token
        news.listUnsubscribeHeaders["List-Unsubscribe"] == "<https://shop.example.com/u/" + news.token + ">"
        news.listUnsubscribeHeaders["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
        row.contactListId == list.news
        row.partyId == party.Cora
        row.contactMechId == email.Cora
        row.communicationEventId == communicationEventId
        row.messageId == "<consent-news-1@example.com>"
        row.purposeEnumId == "PcpMarketingEmail"
        row.tokenHash != news.token
        row.tokenHash == ec.user.singleUseCodeHash(news.token)
        plainCount == 0
        token.promo != token.news
    },
})

feature("resolve#UnsubscribeToken for an anonymous visitor: the organization, the list and the party's lists there, nothing more", {
    when() {
        return anonymously(12, () => {
            const out = call(RESOLVE, { token: token.news })
            const consentWrite = errorOf(STORE, { partyId: party.Cora, purposeEnumId: "PcpPhone", statusId: "PconGranted" })
            const staffPath = errorOf(UNSUBSCRIBE, { contactListId: list.news, partyId: party.Cora })
            return { out, consentWrite, staffPath, userId: ec.user.userId ?? null }
        })
    },
    then({ out, consentWrite, staffPath, userId }) {
        userId == null
        out.organizationName == "Consent Co"
        out.contactListId == list.news
        out.contactListName == "Consent News"
        out.statusId == "CLPT_ACCEPTED"
        out.subscribed == true
        out.unsubscribePending == false
        out.maskedAddress == "c***@example.com"
        out.marketingWithdrawn == false
        out.listList[0].contactListId == list.news
        out.listList[0].isTokenList == true
        ids(out.listList) == [list.news, list.promo, list.confirm].sort()
        out.listList.find((entry) => entry.contactListId === list.confirm).statusId == "CLPT_UNSUBSCRIBED"
        out.partyId == null
        out.listList.every((entry) => entry.partyId == null && entry.preferredContactMechId == null)
        consentWrite != null
        staffPath.includes("needs a signed-in user")
    },
})

feature("an unknown, malformed or expired token, or one used beyond its party and organization, is refused with no data", {
    when() {
        const unknownToken = "A".repeat(32)
        const out = anonymously(13, () => {
            const refused = {
                unknown: errorOf(RESOLVE, { token: unknownToken }),
                expired: errorOf(RESOLVE, { token: token.expired }),
                applyUnknown: errorOf(APPLY, { token: unknownToken, unsubscribeAll: true }),
                otherParty: errorOf(UNSUBSCRIBE, { token: token.news, partyId: party.Dale }),
                otherOrganization: errorOf(UNSUBSCRIBE, { token: token.news, contactListId: list.other }),
            }
            const oneClickNoToken = errorOf(UNSUBSCRIBE, { contactListId: list.news, partyId: party.Cora, listUnsubscribe: "One-Click" })
            // markup is refused by the parameter check before the service runs
            const markup = errorOf(RESOLVE, { token: "<script>alert(1)</script>" })
            let refusedOut = null
            try { refusedOut = ec.service.sync().name(RESOLVE).parameters({ token: token.expired }).call() } finally { ec.message.clearErrors() }
            return { refused, oneClickNoToken, markup, refusedOut }
        })
        out.news = statusOf("news", "Cora")
        out.other = statusOf("other", "Cora")
        out.newsRowCount = consentRows("Cora", { contactListId: list.news }).length
        return out
    },
    then({ refused, oneClickNoToken, markup, refusedOut, news, other, newsRowCount }) {
        Object.values(refused).every((message) => message != null && message.includes("This unsubscribe link is not valid or has expired"))
        Object.keys(refused).length == 5
        oneClickNoToken.includes("needs the link token")
        markup != null
        refusedOut == null || (refusedOut.contactListId == null && refusedOut.organizationName == null && !refusedOut.listList?.length)
        news == "CLPT_ACCEPTED"
        other == "CLPT_ACCEPTED"
        newsRowCount == 0
    },
})

feature("apply#UnsubscribePreferences for an anonymous visitor: each offered list subscribed or not, any other list skipped", {
    when() {
        const out = anonymously(14, () => call(APPLY, { token: token.news, listChoices: [
            { contactListId: list.news, subscribed: false },
            { contactListId: list.confirm, subscribed: "true" },
            { contactListId: list.promo, subscribed: true },
            { contactListId: list.other, subscribed: false },
        ] }))
        const tokenRow = ec.entity.find(TOKEN).condition("tokenHash", ec.user.singleUseCodeHash(token.news)).one()
        return { out, tokenRow, news: statusOf("news", "Cora"), confirm: statusOf("confirm", "Cora"), promo: statusOf("promo", "Cora"),
            other: statusOf("other", "Cora"), newsRows: consentRows("Cora", { contactListId: list.news }),
            confirmRows: consentRows("Cora", { contactListId: list.confirm }) }
    },
    then({ out, tokenRow, news, confirm, promo, other, newsRows, confirmRows }) {
        ids(out.changedList) == [list.news, list.confirm].sort()
        out.failedContactListIds == [list.other]
        news == "CLPT_UNSUBSCRIBED"
        confirm == "CLPT_ACCEPTED"
        promo == "CLPT_ACCEPTED"
        other == "CLPT_ACCEPTED"
        newsRows.length == 1
        newsRows[0].statusId == "PconWithdrawn"
        newsRows[0].sourceEnumId == "PcsEmailLink"
        newsRows[0].userId == null
        newsRows[0].contactMechId == email.Cora
        newsRows[0].evidenceText.includes("of message consent-news-1@example.com")
        confirmRows[0].statusId == "PconGranted"
        confirmRows[0].sourceEnumId == "PcsEmailLink"
        tokenRow.usedDate != null
    },
})

feature("the RFC 8058 one-click POST unsubscribes at once, even from a list that requires confirmation; again changes nothing", {
    when() {
        const out = anonymously(15, () => ({
            oneClick: call(UNSUBSCRIBE, { token: token.promo, listUnsubscribe: "One-Click" }),
            oneClickAgain: call(UNSUBSCRIBE, { token: token.promo, listUnsubscribe: "One-Click" }),
            page: call(UNSUBSCRIBE, { token: token.confirm }),
            confirmOneClick: call(UNSUBSCRIBE, { token: token.confirm, listUnsubscribe: "One-Click" }),
        }))
        return Object.assign(out, { promo: statusOf("promo", "Cora"), confirm: statusOf("confirm", "Cora"),
            promoRows: consentRows("Cora", { contactListId: list.promo }), confirmRows: consentRows("Cora", { contactListId: list.confirm }) })
    },
    then({ oneClick, oneClickAgain, page, confirmOneClick, promo, confirm, promoRows, confirmRows }) {
        oneClick.statusId == "CLPT_UNSUBSCRIBED"
        oneClick.changedList.length == 1
        oneClickAgain.changedList.length == 0
        oneClickAgain.statusId == "CLPT_UNSUBSCRIBED"
        page.statusId == "CLPT_UNSUBS_PENDING"
        confirmOneClick.statusId == "CLPT_UNSUBSCRIBED"
        promo == "CLPT_UNSUBSCRIBED"
        confirm == "CLPT_UNSUBSCRIBED"
        promoRows.length == 3
        promoRows[0].statusId == "PconWithdrawn"
        promoRows[0].sourceEnumId == "PcsEmailLink"
        promoRows[0].evidenceText.includes("One-click unsubscribe")
        confirmRows.length == 3
        confirmRows[0].evidenceText.includes("pending confirmation")
    },
})

feature("unsubscribe from all marketing email by token: that organization's lists, the address withdrawn, allowSolicitation N", {
    when() {
        at(16)
        call(`${CONSENT}.subscribe#ContactListParty`, { contactListId: list.promo, partyId: party.Cora })
        const out = anonymously(16, () => call(UNSUBSCRIBE, { token: token.news, allMarketing: true }))
        const again = anonymously(16, () => call(APPLY, { token: token.news, unsubscribeAll: true }))
        const resolved = anonymously(16, () => call(RESOLVE, { token: token.news }))
        return { out, again, resolved, promo: statusOf("promo", "Cora"), other: statusOf("other", "Cora"), mailbox: statusIn(mailboxId, party.Cora),
            flags: solicitation("Cora", email.Cora), addressRows: consentRows("Cora", { contactListId: null, purposeEnumId: "PcpMarketingEmail" }) }
    },
    then({ out, again, resolved, promo, other, mailbox, flags, addressRows }) {
        ids(out.changedList) == [list.promo]
        out.unchangedContactListIds.slice().sort() == [list.news, list.confirm].sort()
        out.marketingWithdrawn == true
        again.changedList.length == 0
        again.marketingWithdrawn == false
        promo == "CLPT_UNSUBSCRIBED"
        other == "CLPT_ACCEPTED"
        mailbox == "CLPT_ACCEPTED"
        flags == ["N"]
        addressRows.length == 4
        addressRows[0].statusId == "PconWithdrawn"
        addressRows[0].sourceEnumId == "PcsEmailLink"
        addressRows[0].contactMechId == email.Cora
        resolved.marketingWithdrawn == true
        resolved.subscribed == false
    },
})

feature("find#Consents: one row per party with its addresses, lists and purposes; each filter; paging; the CSV export", {
    when() {
        at(17)
        const all = call(`${CONSENT}.find#Consents`, { text: "consentspec" })
        return {
            all,
            byList: findIds({ contactListId: list.other }),
            newsAccepted: findIds({ contactListId: list.news, statusId: "CLPT_ACCEPTED" }),
            unsubscribed: findIds({ statusId: "CLPT_UNSUBSCRIBED" }),
            dataProcessing: findIds({ purposeEnumId: "PcpDataProcessing" }),
            marketingWithdrawn: findIds({ statusId: "PconWithdrawn", purposeEnumId: "PcpMarketingEmail" }),
            notAllowed: findIds({ allowSolicitation: "N" }),
            period: findIds({ changedFromDate: new Date(effectiveTime + 9 * minute), changedThruDate: new Date(effectiveTime + 10 * minute) }),
            byEmail: findIds({ text: "dale.consentspec@" }),
            byPhone: findIds({ text: "5550101" }),
            mailbox: call(`${CONSENT}.find#Consents`, { text: "consentspec", contactListId: mailboxId }).consentListCount,
            page: call(`${CONSENT}.find#Consents`, { text: "consentspec", pageSize: 2, pageIndex: 1 }),
            byName: findIds({ orderByField: "partyName" }),
            csv: call(`${CONSENT}.find#Consents`, { text: "consentspec", exportCsv: true }),
        }
    },
    then({ all, byList, newsAccepted, unsubscribed, dataProcessing, marketingWithdrawn, notAllowed, period, byEmail, byPhone, mailbox, page, byName, csv }) {
        all.consentList.map((row) => row.partyId) == [party.Cora, party.Dale, party.Evan]
        all.consentListCount == 3
        all.consentList[0].partyName == "Cora Consentspec"
        all.consentList[0].emailAddress == "cora.consentspec@example.com"
        all.consentList[0].emailAllowSolicitation == "N"
        all.consentList[0].phoneNumber == "801 555-0101"
        all.consentList[0].phoneAllowSolicitation == "N"
        all.consentList[0].grantedPurposeEnumIds == ["PcpDataProcessing"]
        all.consentList[0].withdrawnPurposeEnumIds.slice().sort() == ["PcpMarketingEmail", "PcpPhone", "PcpSms"]
        all.consentList[0].lastSourceEnumId == "PcsEmailLink"
        ids(all.consentList[0].listList) == [list.news, list.promo, list.confirm, list.other].sort()
        all.consentList[2].lastChangeDate == null
        byList == [party.Cora]
        newsAccepted == [party.Evan]
        unsubscribed.slice().sort() == [party.Cora, party.Dale].sort()
        dataProcessing == [party.Cora]
        marketingWithdrawn.slice().sort() == [party.Cora, party.Dale].sort()
        notAllowed.slice().sort() == [party.Cora, party.Dale].sort()
        period == [party.Dale]
        byEmail == [party.Dale]
        byPhone == [party.Cora]
        mailbox == 0
        page.consentListCount == 3
        page.consentList.map((row) => row.partyId) == [party.Evan]
        page.consentListPageMaxIndex == 1
        byName == [party.Cora, party.Dale, party.Evan]
        csv.contentType == "text/csv"
        csv.csvText.split("\r\n").filter((line) => line).length == 4
        csv.csvText.startsWith("Party ID,Name,Email,Email Allow Solicitation,Phone")
        csv.csvText.includes("Cora Consentspec,cora.consentspec@example.com,N,801 555-0101,N")
        csv.csvText.includes("Consent News: Unsubscribed")
        csv.csvText.includes("Data Processing")
        !csv.csvText.includes("Consent team room")
    },
})

feature("a mailbox is membership, not consent: left out of the state and of unsubscribing until it has members by email", {
    when() {
        at(18)
        const before = ids(call(`${CONSENT}.get#PartyConsentState`, { partyId: party.Dale }).listList)
        const refused = errorOf(UNSUBSCRIBE, { contactListId: mailboxId, partyId: party.Dale })
        // a member by email, as the later mailbox email bridge sets it
        const row = Array.from(ec.entity.find(CLP).condition({ contactListId: mailboxId, partyId: party.Dale }).list())[0]
        row.set("preferredContactMechId", email.Dale)
        row.update()
        const after = ids(call(`${CONSENT}.get#PartyConsentState`, { partyId: party.Dale }).listList)
        row.set("preferredContactMechId", null)
        row.update()
        return { before, refused, after }
    },
    then({ before, refused, after }) {
        before == [list.news, list.promo].sort()
        refused.includes("is a mailbox")
        after.includes(mailboxId)
    },
})

feature("unsubscribe#ContactListParties, the bulk action: each party on its own, one that fails listed and the rest done", {
    when() {
        at(18)
        const out = call(`${CONSENT}.unsubscribe#ContactListParties`, { contactListId: list.confirm,
            partyIdList: [party.Cora, party.Dale, "NO_SUCH_PARTY"], confirmed: true })
        return { out, cora: statusOf("confirm", "Cora"), dale: statusOf("confirm", "Dale"), daleRows: consentRows("Dale", { contactListId: list.confirm }) }
    },
    then({ out, cora, dale, daleRows }) {
        out.unsubscribedCount == 1
        out.unchangedCount == 1
        out.pendingCount == 0
        out.failedPartyIdList == ["NO_SUCH_PARTY"]
        cora == "CLPT_UNSUBSCRIBED"
        // a party not on the list is kept off it
        dale == "CLPT_UNSUBSCRIBED"
        daleRows.length == 1
        daleRows[0].sourceEnumId == "PcsStaff"
    },
})

feature("merge#Parties moves the consent rows and the unsubscribe tokens of the merged party", {
    when() {
        at(19)
        call(STORE, { partyId: party.Evan, contactMechId: email.Evan, purposeEnumId: "PcpMarketingEmail", statusId: "PconGranted",
            sourceEnumId: "PcsImport", evidenceText: "consent.csv row 7" })
        const evanToken = call(CREATE_TOKEN, { contactListId: list.news, partyId: party.Evan }).token
        at(20)
        call("mantle.party.DuplicateServices.merge#Parties", { toPartyId: party.Fay, fromPartyId: party.Evan })
        const resolved = anonymously(20, () => call(RESOLVE, { token: evanToken }))
        return { resolved, evanRows: consentRows("Evan").length, fayRows: consentRows("Fay"),
            evanTokens: ec.entity.find(TOKEN).condition("partyId", party.Evan).count(),
            fayTokens: ec.entity.find(TOKEN).condition("partyId", party.Fay).count(), found: findIds() }
    },
    then({ resolved, evanRows, fayRows, evanTokens, fayTokens, found }) {
        evanRows == 0
        fayRows.length == 1
        fayRows[0].sourceEnumId == "PcsImport"
        fayRows[0].evidenceText == "consent.csv row 7"
        evanTokens == 0
        fayTokens == 1
        resolved.contactListId == list.news
        resolved.subscribed == true
        !found.includes(party.Evan)
        found.includes(party.Fay)
    },
})
