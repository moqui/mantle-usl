// CalDAV and CardDAV over Mantle (mantle.work.CalendarDavServices, mantle.party.ContactDavServices): the framework's DAV
// server (org.moqui.impl.DavServices.serve#DavRequest, as a phone sends each request, with an app password) finds the
// user's calendars, tasks and contact books, reads events and tasks as CalDAV objects and contacts as vCards, writes
// what a phone writes (new, changed, deleted, with entity tags), and refuses what the user may not change. New spec.
const hour = 3600000
const day = 24 * hour
const dayStart = Date.UTC(2027, 5, 7, 5, 0, 0)
const DAV = "org.moqui.impl.DavServices.serve#DavRequest"
const s = {}

spec({
    stepwise: true,
    // the real clock: each DAV request runs in a context of its own, as on a server, which has no effective time of the spec
    setupSpec() { login("john.doe") },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() {
        ec.artifactExecution.enableAuthz()
        login("john.doe")
    },
})

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
function base64(text) {
    const bytes = Array.from(unescape(encodeURIComponent(text))).map((ch) => ch.charCodeAt(0))
    let out = ""
    for (let i = 0; i < bytes.length; i += 3) {
        const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]]
        const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
        out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (b == null ? "=" : B64[(n >> 6) & 63]) + (c == null ? "=" : B64[n & 63])
    }
    return out
}
// one request as the phone sends it, in a context of its own with authorization on, so the adapters' own grants are what
// lets the user in
const dav = (method, path, body, headers) => call(DAV, { method, path, body: body ?? null,
    headers: Object.assign({ Authorization: `Basic ${base64(`dv.ana:${s.password}`)}` }, headers || {}) })
const report = (path, xml) => dav("REPORT", path, xml, { Depth: "1" })
const etagOf = (response) => response.headers.ETag || response.headers.etag
const between = (text, open, close) => {
    const start = text.indexOf(open)
    if (start < 0) return null
    const end = text.indexOf(close, start + open.length)
    return end < 0 ? null : text.substring(start + open.length, end)
}
const unescapeXml = (text) => String(text).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&")
const QUERY_EVENTS = `<?xml version="1.0"?><C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
    <D:prop><D:getetag/><C:calendar-data/></D:prop><C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT">
    <C:time-range start="20270601T000000Z" end="20270701T000000Z"/></C:comp-filter></C:comp-filter></C:filter></C:calendar-query>`
const QUERY_TODOS = `<?xml version="1.0"?><C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
    <D:prop><D:getetag/><C:calendar-data/></D:prop><C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VTODO"/>
    </C:comp-filter></C:filter></C:calendar-query>`
const PROPFIND_CTAG = `<?xml version="1.0"?><D:propfind xmlns:D="DAV:" xmlns:CS="http://calendarserver.org/ns/"><D:prop>
    <D:resourcetype/><D:displayname/><CS:getctag/></D:prop></D:propfind>`
const ics = (uid, summary, startText, endText, extra) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Spec//EN", "BEGIN:VEVENT",
    `UID:${uid}`, `DTSTAMP:20270601T000000Z`, `DTSTART:${startText}`, `DTEND:${endText}`, `SUMMARY:${summary}`].concat(extra || [],
    ["END:VEVENT", "END:VCALENDAR", ""]).join("\r\n")
const vcard = (uid, given, family, lines) => ["BEGIN:VCARD", "VERSION:3.0", `UID:${uid}`, `FN:${given} ${family}`, `N:${family};${given};;;`]
        .concat(lines || [], ["END:VCARD", ""]).join("\r\n")

feature("a user with an app password, a default calendar with an event, a task and a contact book", {
    when() {
        s.partyId = call("mantle.party.PartyServices.create#Person", { firstName: "Ana", lastName: "Davspec" }).partyId
        s.userId = call("mantle.party.PartyServices.create#PartyUserAccount", { partyId: s.partyId, emailAddress: "dv.ana@example.com",
                username: "dv.ana", newPassword: "moqui1!!", newPasswordVerify: "moqui1!!", timeZone: "America/Chicago" }).userId
        login("dv.ana", "moqui1!!")
        try {
            s.password = call("org.moqui.impl.UserServices.create#UserAppPassword", { name: "Ana's phone" }).password
            s.calendarId = call("mantle.work.CalendarServices.ensure#UserDefaultCalendar", {}).calendarId
            s.eventId = call("mantle.work.EventServices.create#Event", { workEffortName: "Planning review", calendarId: s.calendarId,
                    statusId: "WeApproved", estimatedStartDate: new Date(dayStart + 10 * hour), estimatedCompletionDate: new Date(dayStart + 11 * hour) }).workEffortId
            s.taskId = call("mantle.work.TaskServices.create#SimpleTask", { workEffortName: "Send the minutes", assignToPartyId: s.partyId,
                    estimatedCompletionDate: new Date(dayStart + 2 * day + 17 * hour) }).workEffortId
            s.bookId = call("mantle.party.ContactBookServices.ensure#UserDefaultContactBook", {}).contactBookId
        } finally { login("john.doe") }
        return {}
    },
    then() {
        s.password.length == 24
        s.calendarId != null
        s.eventId != null
        s.taskId != null
        s.bookId != null
    },
})

feature("discovery: the principal names the calendar and address book homes, the homes list the collections with ctags", {
    when() {
        const principal = dav("PROPFIND", "/dav/principals/dv.ana/", null, { Depth: "0" })
        const calendars = dav("PROPFIND", "/dav/calendars/dv.ana/", PROPFIND_CTAG, { Depth: "1" })
        const books = dav("PROPFIND", "/dav/addressbooks/dv.ana/", PROPFIND_CTAG, { Depth: "1" })
        const wrongPassword = call(DAV, { method: "PROPFIND", path: "/dav/", headers: { Authorization: `Basic ${base64("dv.ana:moqui1!!")}` } })
        const other = dav("PROPFIND", "/dav/calendars/john.doe/", null, { Depth: "1" })
        s.calendarCtag = between(calendars.body.substring(calendars.body.indexOf(`/${s.calendarId}/`)), "<CS:getctag>", "</CS:getctag>")
        return { principal, calendars, books, wrongPassword, other }
    },
    then({ principal, calendars, books, wrongPassword, other }) {
        principal.status == 207
        principal.body.includes("<C:calendar-home-set><D:href>/dav/calendars/dv.ana/</D:href>")
        principal.body.includes("<CR:addressbook-home-set><D:href>/dav/addressbooks/dv.ana/</D:href>")
        principal.body.includes("mailto:dv.ana@example.com")
        calendars.status == 207
        calendars.body.includes(`/dav/calendars/dv.ana/${s.calendarId}/`)
        calendars.body.includes("<C:calendar/>")
        calendars.body.includes("/dav/calendars/dv.ana/tasks/")
        s.calendarCtag != null
        books.status == 207
        books.body.includes(`/dav/addressbooks/dv.ana/${s.bookId}/`)
        books.body.includes("<CR:addressbook/>")
        wrongPassword.status == 401
        other.status == 404
    },
})

feature("a calendar query returns the event as a calendar object: no METHOD, the series by its name", {
    when() {
        const found = report(`/dav/calendars/dv.ana/${s.calendarId}/`, QUERY_EVENTS)
        const data = unescapeXml(between(found.body, "<C:calendar-data>", "</C:calendar-data>") || "")
        const outside = report(`/dav/calendars/dv.ana/${s.calendarId}/`, QUERY_EVENTS.replace("20270601T000000Z", "20280101T000000Z")
                .replace("20270701T000000Z", "20280201T000000Z"))
        return { found, data, outside }
    },
    then({ found, data, outside }) {
        found.status == 207
        found.body.includes(`/dav/calendars/dv.ana/${s.calendarId}/${s.eventId}.ics`)
        data.includes("BEGIN:VEVENT")
        data.includes("SUMMARY:Planning review")
        !data.includes("METHOD:")
        !outside.body.includes(`${s.eventId}.ics`)
    },
})

feature("a phone's new event is stored by its UID under the phone's name, then changed with its tag and deleted", {
    when() {
        const path = `/dav/calendars/dv.ana/${s.calendarId}/phone-event-1.ics`
        const created = dav("PUT", path, ics("phone-event-1@example.com", "Dentist", "20270609T150000Z", "20270609T160000Z"), { "If-None-Match": "*" })
        const row = ec.entity.find("mantle.work.calendar.CalendarWorkEffortDetail").condition("calendarId", s.calendarId)
                .condition("universalId", "phone-event-1@example.com").one()
        const again = dav("PUT", path, ics("phone-event-1@example.com", "Dentist", "20270609T150000Z", "20270609T160000Z"), { "If-None-Match": "*" })
        const stale = dav("PUT", path, ics("phone-event-1@example.com", "Dentist moved", "20270610T150000Z", "20270610T160000Z"), { "If-Match": "\"stale\"" })
        const changed = dav("PUT", path, ics("phone-event-1@example.com", "Dentist moved", "20270610T150000Z", "20270610T160000Z"), { "If-Match": etagOf(created) })
        const moved = ec.entity.find("mantle.work.effort.WorkEffort").condition("workEffortId", row.workEffortId).one()
        const got = dav("GET", path)
        const calendars = dav("PROPFIND", "/dav/calendars/dv.ana/", PROPFIND_CTAG, { Depth: "1" })
        const ctag = between(calendars.body.substring(calendars.body.indexOf(`/${s.calendarId}/`)), "<CS:getctag>", "</CS:getctag>")
        const deleted = dav("DELETE", path, null, { "If-Match": etagOf(changed) })
        const after = ec.entity.find("mantle.work.effort.WorkEffort").condition("workEffortId", row.workEffortId).one()
        const gone = dav("GET", path)
        return { created, row, again, stale, changed, moved, got, ctag, deleted, after, gone }
    },
    then({ created, row, again, stale, changed, moved, got, ctag, deleted, after, gone }) {
        created.status == 201
        etagOf(created) != null
        row.davName == "phone-event-1.ics"
        row.workEffortName == "Dentist"
        row.ownerPartyId == s.partyId
        again.status == 412
        stale.status == 412
        changed.status == 204
        moved.workEffortName == "Dentist moved"
        etagOf(changed) != etagOf(created)
        got.status == 200
        got.body.includes("SUMMARY:Dentist moved")
        ctag != s.calendarCtag
        deleted.status == 204
        after.statusId == "WeCancelled"
        gone.status == 404
    },
})

feature("the Tasks collection: the user's task as a VTODO, a new one from the phone, and its completion", {
    when() {
        const found = report("/dav/calendars/dv.ana/tasks/", QUERY_TODOS)
        const path = "/dav/calendars/dv.ana/tasks/phone-todo-1.ics"
        const todo = (status) => ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VTODO", "UID:phone-todo-1", "SUMMARY:Buy stamps",
            "DUE;VALUE=DATE:20270611", `STATUS:${status}`].concat(status === "COMPLETED" ? ["COMPLETED:20270608T120000Z"] : [],
            ["END:VTODO", "END:VCALENDAR", ""]).join("\r\n")
        const created = dav("PUT", path, todo("NEEDS-ACTION"))
        const task = ec.entity.find("mantle.work.effort.WorkEffort").condition("universalId", "phone-todo-1").one()
        const assigned = ec.entity.find("mantle.work.effort.WorkEffortParty").condition("workEffortId", task.workEffortId).condition("partyId", s.partyId).one()
        const done = dav("PUT", path, todo("COMPLETED"))
        const completed = ec.entity.find("mantle.work.effort.WorkEffort").condition("workEffortId", task.workEffortId).one()
        const eventsAsked = report("/dav/calendars/dv.ana/tasks/", QUERY_EVENTS)
        return { found, created, task, assigned, done, completed, eventsAsked }
    },
    then({ found, created, task, assigned, done, completed, eventsAsked }) {
        found.status == 207
        found.body.includes(`/dav/calendars/dv.ana/tasks/${s.taskId}.ics`)
        found.body.includes("BEGIN:VTODO")
        found.body.includes("SUMMARY:Send the minutes")
        created.status == 201
        task.workEffortTypeEnumId == "WetTask"
        task.workEffortName == "Buy stamps"
        assigned != null
        done.status == 204
        completed.statusId == "WeComplete"
        completed.actualCompletionDate != null
        !eventsAsked.body.includes(".ics")
    },
})

feature("a phone's new card is a personal contact in the book; a changed card replaces its email; a deleted card goes", {
    when() {
        const path = `/dav/addressbooks/dv.ana/${s.bookId}/phone-card-1.vcf`
        const created = dav("PUT", path, vcard("phone-card-1", "Pat", "Phonebook", ["EMAIL;TYPE=HOME:pat.old@example.com"]))
        const member = ec.entity.find("mantle.party.contact.ContactBookParty").condition("contactBookId", s.bookId).condition("davName", "phone-card-1.vcf").one()
        const party = ec.entity.find("mantle.party.Party").condition("partyId", member.partyId).one()
        const got = dav("GET", path)
        const multiget = report(`/dav/addressbooks/dv.ana/${s.bookId}/`, `<?xml version="1.0"?><CR:addressbook-multiget xmlns:D="DAV:"
            xmlns:CR="urn:ietf:params:xml:ns:carddav"><D:prop><D:getetag/><CR:address-data/></D:prop>
            <D:href>/dav/addressbooks/dv.ana/${s.bookId}/phone-card-1.vcf</D:href><D:href>/dav/addressbooks/dv.ana/${s.bookId}/none.vcf</D:href></CR:addressbook-multiget>`)
        const changed = dav("PUT", path, vcard("phone-card-1", "Pat", "Phonebook", ["EMAIL;TYPE=HOME:pat.new@example.com", "TEL;TYPE=CELL:+1 312 555 0142"]),
                { "If-Match": etagOf(created) })
        const emails = Array.from(ec.entity.find("mantle.party.contact.PartyContactMechInfo").condition("partyId", member.partyId)
                .condition(ec.entity.conditionFactory.makeConditionDate("fromDate", "thruDate", null)).list())
                .filter((info) => info.contactMechTypeEnumId === "CmtEmailAddress").map((info) => info.infoString)
        const deleted = dav("DELETE", path)
        const left = ec.entity.find("mantle.party.contact.ContactBookParty").condition("contactBookId", s.bookId).condition("partyId", member.partyId)
                .condition(ec.entity.conditionFactory.makeConditionDate("fromDate", "thruDate", null)).one()
        return { created, member, party, got, multiget, changed, emails, deleted, left }
    },
    then({ created, member, party, got, multiget, changed, emails, deleted, left }) {
        created.status == 201
        member.davUid == "phone-card-1"
        party.privateOwnerUserId == s.userId
        got.status == 200
        got.body.includes("UID:phone-card-1")
        got.body.includes("pat.old@example.com")
        got.body.includes("VERSION:3.0")
        multiget.status == 207
        multiget.body.includes("FN:Pat Phonebook")
        multiget.body.includes("none.vcf</D:href><D:status>HTTP/1.1 404")
        changed.status == 204
        emails == ["pat.new@example.com"]
        deleted.status == 204
        left == null
    },
})
