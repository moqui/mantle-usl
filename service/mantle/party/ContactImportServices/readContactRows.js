/*
 * This software is in the public domain under CC0 1.0 Universal plus a
 * Grant of Patent License.
 *
 * To the extent possible under law, the author(s) have dedicated all
 * copyright and related and neighboring rights to this software to the
 * public domain worldwide. This software is distributed without any
 * warranty.
 *
 * You should have received a copy of the CC0 Public Domain Dedication
 * along with this software (see the LICENSE.md file). If not, see
 * <http://creativecommons.org/publicdomain/zero/1.0/>.
 */

// mantle.party.ContactImportServices.read#ContactRows: a contact file's columns, and each row mapped to a contact (the
// map mantle.party.ContactBookServices.store#ContactParty takes, with groupNames and isFavorite) and its problems.
//
// A column maps to a target field: a single field (firstName, organizationName, groups, ...) or a numbered slot of an
// email, phone, address or website, with a part (email1, email1.label, address2.city) and an optional fixed purpose
// after a colon (phone3:PhoneMobile). A slot's label (Google's "* Home", "Mobile") picks its purpose when none is fixed.

const cf = ec.entity.conditionFactory
fileKind = null
columnList = []
contactList = []
rowCount = 0

// ===== the target fields, for a mapping drop-down
const scalarTargets = [["fullName", "Full name"], ["firstName", "First name"], ["middleName", "Middle name"],
    ["lastName", "Last name"], ["prefix", "Name prefix"], ["suffix", "Name suffix"], ["nickname", "Nickname"],
    ["organizationName", "Organization"], ["jobTitle", "Job title"], ["department", "Department"],
    ["birthday", "Birthday"], ["notes", "Notes"], ["groups", "Groups (labels)"]]
targetFieldList = [{fieldName: "", description: "(ignore)"}].concat(scalarTargets.map(([fieldName, description]) => ({fieldName, description})))
for (let n = 1; n <= 3; n++) {
    targetFieldList.push({fieldName: `email${n}`, description: `Email ${n}`}, {fieldName: `email${n}.label`, description: `Email ${n} label`})
}
for (let n = 1; n <= 4; n++) {
    targetFieldList.push({fieldName: `phone${n}`, description: `Phone ${n}`}, {fieldName: `phone${n}.label`, description: `Phone ${n} label`})
}
const addressParts = [["street", "street"], ["street2", "street line 2"], ["city", "city"], ["region", "state or region"],
    ["postalCode", "postal code"], ["country", "country"], ["poBox", "PO box"], ["formatted", "formatted"], ["label", "label"]]
for (let n = 1; n <= 2; n++) {
    for (const [part, words] of addressParts) targetFieldList.push({fieldName: `address${n}.${part}`, description: `Address ${n} ${words}`})
}
for (let n = 1; n <= 2; n++) targetFieldList.push({fieldName: `website${n}`, description: `Website ${n}`})

// ===== the file's text, in its character set (a UTF-16 byte order mark wins)
let content = fileText
let name = fileName || null
if (content == null && (contactFile != null || fileLocation)) {
    const read = ec.service.sync().name("mantle.party.ContactImportServices.read#ContactFileText").parameters({contactFile: contactFile,
        fileLocation: contactFile != null ? null : fileLocation, characterSet: characterSet || "UTF-8"}).call()
    if (ec.message.hasError()) return
    content = read.text
    if (!name && contactFile != null) name = contactFile.getName()
}
if (content == null || String(content).trim() === "") { ec.message.addError("The contact file is empty"); return }
content = String(content)
if (content.charCodeAt(0) === 0xFEFF) content = content.substring(1)

let headers = []
let rows = []
let presetMapping = null
if (/\.vcf$/i.test(name || "") || /^\s*BEGIN:VCARD/i.test(content)) {
    // vCard parsing is the framework's VCard tool (IronStone M4). Its parse(text) returns a map per card keyed by the
    // target fields here (firstName, email1, email1.label, address1.city, ...), so the columns map to themselves.
    fileKind = "vcard"
    if (ec.factory.getToolFactory("VCard") == null) { ec.message.addError("vCard import is not available yet"); return }
    const cards = Array.from(ec.factory.getTool("VCard").parse(content) || [])
    const seen = new Set()
    for (const card of cards) for (const key of Object.keys(card)) if (!seen.has(key)) { seen.add(key); headers.push(key) }
    rows = cards.map((card) => {
        const values = {}
        for (const key of headers) values[key] = card[key] == null ? null : String(card[key])
        return values
    })
    presetId = "vcard"
    presetMapping = Object.fromEntries(headers.map((header) => [header, header]))
} else {
    fileKind = "csv"
    // RFC 4180 records: quoted fields with doubled quotes and line breaks; the delimiter is the header line's commonest
    // of comma, semicolon and tab
    const firstLine = content.split(/\r?\n/, 1)[0]
    const outside = firstLine.replace(/"[^"]*"/g, "")
    const delimiter = [",", ";", "\t"].map((d) => [d, outside.split(d).length]).sort((a, b) => b[1] - a[1])[0][0]
    const records = []
    let record = []
    let field = ""
    let quoted = false
    for (let i = 0; i < content.length; i++) {
        const ch = content[i]
        if (quoted) {
            if (ch === "\"") {
                if (content[i + 1] === "\"") { field += "\""; i++ } else quoted = false
            } else field += ch
        } else if (ch === "\"" && field === "") {
            quoted = true
        } else if (ch === delimiter) {
            record.push(field); field = ""
        } else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && content[i + 1] === "\n") i++
            record.push(field); field = ""
            records.push(record); record = []
        } else field += ch
    }
    if (field !== "" || record.length) { record.push(field); records.push(record) }
    const nonEmpty = records.filter((rec) => rec.some((value) => value.trim() !== ""))
    if (!nonEmpty.length) { ec.message.addError("The contact file has no header line"); return }
    // a repeated column name gets a number, so each column keeps its values
    const counts = {}
    headers = nonEmpty[0].map((header) => {
        const base = header.trim()
        counts[base] = (counts[base] || 0) + 1
        return counts[base] > 1 ? `${base} (${counts[base]})` : base
    })
    rows = nonEmpty.slice(1).map((rec) => {
        const values = {}
        headers.forEach((header, index) => { values[header] = rec[index] == null ? null : rec[index] })
        return values
    })
}
rowCount = rows.length

// ===== presets: Google Contacts (the current and the older export), Outlook, and a generic match by header words
const googleFixed = {"Name": "fullName", "First Name": "firstName", "Given Name": "firstName", "Middle Name": "middleName",
    "Additional Name": "middleName", "Last Name": "lastName", "Family Name": "lastName", "Name Prefix": "prefix",
    "Name Suffix": "suffix", "Nickname": "nickname", "Organization Name": "organizationName", "Organization Title": "jobTitle",
    "Organization Department": "department", "Organization 1 - Name": "organizationName", "Organization 1 - Title": "jobTitle",
    "Organization 1 - Department": "department", "Birthday": "birthday", "Notes": "notes", "Labels": "groups",
    "Group Membership": "groups"}
const googleAddressParts = {"Label": "label", "Type": "label", "Formatted": "formatted", "Street": "street", "City": "city",
    "PO Box": "poBox", "Region": "region", "Postal Code": "postalCode", "Country": "country", "Extended Address": "street2"}
const googleTarget = (header) => {
    if (googleFixed[header]) return googleFixed[header]
    let match = /^(E-mail|Phone|Website) (\d+) - (Label|Type|Value)$/.exec(header)
    if (match) {
        const kind = {"E-mail": "email", "Phone": "phone", "Website": "website"}[match[1]]
        return match[3] === "Value" ? `${kind}${match[2]}` : `${kind}${match[2]}.label`
    }
    match = /^Address (\d+) - (.+)$/.exec(header)
    if (match && googleAddressParts[match[2]]) return `address${match[1]}.${googleAddressParts[match[2]]}`
    return null
}
const outlookFixed = {"First Name": "firstName", "Middle Name": "middleName", "Last Name": "lastName", "Title": "prefix",
    "Suffix": "suffix", "Nickname": "nickname", "Company": "organizationName", "Job Title": "jobTitle", "Department": "department",
    "E-mail Address": "email1:EmailPrimary", "E-mail 2 Address": "email2:EmailOther", "E-mail 3 Address": "email3:EmailOther",
    "Mobile Phone": "phone1:PhoneMobile", "Business Phone": "phone2:PhoneWork", "Home Phone": "phone3:PhoneHome",
    "Primary Phone": "phone4:PhonePrimary", "Business Phone 2": "phone5:PhoneWork", "Home Phone 2": "phone6:PhoneHome",
    "Other Phone": "phone7:Other", "Business Fax": "phone8:PhoneFax", "Home Fax": "phone9:PhoneFax",
    "Assistant's Phone": "phone10:PhoneAssistant", "Company Main Phone": "phone11:PhoneWork", "Car Phone": "phone12:PhoneMobile",
    "Web Page": "website1", "Personal Web Page": "website2", "Birthday": "birthday", "Notes": "notes", "Categories": "groups"}
const outlookAddressParts = {"Street": "street", "Street 2": "street2", "City": "city", "State": "region",
    "Postal Code": "postalCode", "Country/Region": "country", "Country": "country", "PO Box": "poBox"}
const outlookAddressSlots = {"Business": ["address1", "PostalWork"], "Home": ["address2", "PostalHome"], "Other": ["address3", "PostalGeneral"]}
const outlookTarget = (header) => {
    if (outlookFixed[header]) return outlookFixed[header]
    const match = /^(Business|Home|Other) (Street 2|Street 3|Street|City|State|Postal Code|Country\/Region|Country|PO Box)$/.exec(header)
    if (match) {
        const [slot, purposeId] = outlookAddressSlots[match[1]]
        // a third street line joins the second
        const part = match[2] === "Street 3" ? "street2" : outlookAddressParts[match[2]]
        return `${slot}.${part}:${purposeId}`
    }
    return null
}
const genericFixed = {name: "fullName", fullname: "fullName", displayname: "fullName", contactname: "fullName",
    firstname: "firstName", givenname: "firstName", first: "firstName", middlename: "middleName", lastname: "lastName",
    surname: "lastName", familyname: "lastName", last: "lastName", prefix: "prefix", nameprefix: "prefix", suffix: "suffix",
    namesuffix: "suffix", nickname: "nickname", company: "organizationName", companyname: "organizationName",
    organization: "organizationName", organisation: "organizationName", organizationname: "organizationName", org: "organizationName",
    title: "jobTitle", jobtitle: "jobTitle", position: "jobTitle", department: "department", email: "email1", emailaddress: "email1",
    mail: "email1", email1: "email1", email2: "email2", email3: "email3", phone: "phone1", telephone: "phone1", phonenumber: "phone1",
    tel: "phone1", mobile: "phone2:PhoneMobile", mobilephone: "phone2:PhoneMobile", cell: "phone2:PhoneMobile",
    cellphone: "phone2:PhoneMobile", workphone: "phone3:PhoneWork", businessphone: "phone3:PhoneWork", officephone: "phone3:PhoneWork",
    homephone: "phone4:PhoneHome", fax: "phone5:PhoneFax", address: "address1.street", street: "address1.street",
    streetaddress: "address1.street", address1: "address1.street", address2: "address1.street2", city: "address1.city",
    town: "address1.city", state: "address1.region", region: "address1.region", province: "address1.region",
    stateprovince: "address1.region", zip: "address1.postalCode", zipcode: "address1.postalCode", postalcode: "address1.postalCode",
    postcode: "address1.postalCode", country: "address1.country", website: "website1", web: "website1", url: "website1",
    homepage: "website1", birthday: "birthday", birthdate: "birthday", dateofbirth: "birthday", dob: "birthday", notes: "notes",
    note: "notes", comments: "notes", groups: "groups", group: "groups", labels: "groups", categories: "groups", tags: "groups"}
const genericTarget = (header) => genericFixed[header.toLowerCase().replace(/[^a-z0-9]/g, "")] || googleTarget(header) || outlookTarget(header)

if (!presetId) {
    const has = (header) => headers.includes(header)
    if (has("E-mail 1 - Value") || has("Given Name") || has("Labels") || has("Group Membership") || has("Organization Name")) presetId = "google"
    else if (has("E-mail Address") || has("Business Phone") || has("Mobile Phone") || has("Categories")) presetId = "outlook"
    else presetId = "generic"
}
const presetTarget = presetId === "google" ? googleTarget : (presetId === "outlook" ? outlookTarget : genericTarget)
const mapping = {}
for (const header of headers) {
    let target = presetMapping ? presetMapping[header] : (presetTarget(header) || (presetId !== "generic" ? genericTarget(header) : null))
    if (columnMapping != null && Object.prototype.hasOwnProperty.call(columnMapping, header)) target = columnMapping[header]
    mapping[header] = target && target !== "ignore" ? String(target) : null
}
columnMapping = mapping
const sampleCount = maxRows != null ? Math.max(0, Number(maxRows)) : rows.length
columnList = headers.map((header, index) => ({columnIndex: index, columnName: header, targetField: mapping[header],
    sampleValues: rows.slice(0, Math.min(3, sampleCount)).map((values) => values[header])}))

// ===== a row as a contact
const geoRegions = new Map()
const geoCountries = new Map()
const countryGeoIdOf = (value) => {
    const key = value.trim().toUpperCase()
    if (geoCountries.has(key)) return geoCountries.get(key)
    const found = ec.entity.find("moqui.basic.Geo").condition("geoTypeEnumId", "GEOT_COUNTRY").condition(cf.makeCondition([
        cf.makeCondition("geoId", "equals", key), cf.makeCondition("geoCodeAlpha2", "equals", key), cf.makeCondition("geoCodeAlpha3", "equals", key),
        cf.makeCondition("geoName", "equals", value.trim(), false, true)], "or")).list()
    const geoId = found.length ? found[0].geoId : null
    geoCountries.set(key, geoId)
    return geoId
}
const regionGeoIdOf = (value, countryGeoId) => {
    if (!geoRegions.has(countryGeoId)) {
        const regionIds = Array.from(ec.entity.find("moqui.basic.GeoAssoc").condition("geoId", countryGeoId)
                .condition("geoAssocTypeEnumId", "GAT_REGIONS").list()).map((assoc) => assoc.toGeoId)
        geoRegions.set(countryGeoId, regionIds.length ? Array.from(ec.entity.find("moqui.basic.Geo")
                .condition(cf.makeCondition("geoId", "in", regionIds)).list()).map((geo) => geo.getMap()) : [])
    }
    const key = value.trim().toUpperCase()
    const region = geoRegions.get(countryGeoId).find((geo) => geo.geoId === key || String(geo.geoCodeAlpha2 || "").toUpperCase() === key
            || String(geo.geoName || "").toUpperCase() === key || geo.geoId === `${countryGeoId}_${key}`)
    return region ? region.geoId : null
}
// a phone number as country code, area code and number: "+1 801 555 1234", "(801) 555-1234", "+44 20 7946 0958",
// "555-1234"; ten digits without a country code are read as a North American number
const parsePhone = (text) => {
    let raw = text.trim()
    const extension = /\s*(?:ext\.?|x)\s*(\d+)$/i.exec(raw)
    if (extension) raw = raw.substring(0, extension.index)
    const digits = raw.replace(/\D/g, "")
    const seven = (number) => number.length === 7 ? `${number.substring(0, 3)}-${number.substring(3)}` : number
    let countryCode = null
    let national = digits
    if (raw.startsWith("+")) {
        if (digits.length === 11 && digits.startsWith("1")) { countryCode = "1"; national = digits.substring(1) }
        else {
            const groups = raw.substring(1).split(/[^\d]+/).filter((group) => group)
            if (groups.length > 1) { countryCode = groups[0]; national = groups.slice(1).join("") }
            else if (digits.length > 10) { countryCode = digits.substring(0, digits.length - 10); national = digits.substring(digits.length - 10) }
        }
    } else if (digits.length === 11 && digits.startsWith("1")) { countryCode = "1"; national = digits.substring(1) }
    if ((countryCode === "1" || countryCode == null) && national.length === 10) {
        return {countryCode: countryCode || "1", areaCode: national.substring(0, 3), contactNumber: seven(national.substring(3))}
    }
    return {countryCode: countryCode, areaCode: null, contactNumber: countryCode ? national : raw.replace(/[^\d.\- ]/g, "").trim()}
}
const phonePurposes = {mobile: "PhoneMobile", cell: "PhoneMobile", iphone: "PhoneMobile", home: "PhoneHome", work: "PhoneWork",
    business: "PhoneWork", office: "PhoneWork", main: "PhonePrimary", primary: "PhonePrimary", fax: "PhoneFax", "home fax": "PhoneFax",
    "work fax": "PhoneFax", "business fax": "PhoneFax", assistant: "PhoneAssistant", other: "Other", pager: "Other"}
const postalPurposes = {home: "PostalHome", work: "PostalWork", business: "PostalWork", other: "PostalGeneral"}
const labelText = (label) => String(label || "").replace(/^\*\s*/, "").trim().toLowerCase()
// a birthday as yyyy-MM-dd: ISO, vCard's yyyyMMdd and Outlook's M/d/yyyy; Google's --MM-dd has no year
const parseBirthday = (text, problems) => {
    const value = text.trim()
    let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value) || /^(\d{4})(\d{2})(\d{2})$/.exec(value)
    let year, month, day
    if (match) { year = match[1]; month = match[2]; day = match[3] }
    else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(value))) {
        if (Number(match[1]) === 0 || Number(match[2]) === 0) return null
        year = match[3].length === 2 ? (Number(match[3]) > 30 ? "19" : "20") + match[3] : match[3]
        month = match[1]; day = match[2]
    } else if (/^--\d{2}-?\d{2}$/.test(value)) {
        problems.push(`Birthday ${value} has no year and is left out`)
        return null
    } else {
        problems.push(`Birthday ${value} is not a date and is left out`)
        return null
    }
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
    if (Number.isNaN(date.getTime()) || date.getUTCMonth() !== Number(month) - 1) {
        problems.push(`Birthday ${value} is not a date and is left out`)
        return null
    }
    return date.toISOString().substring(0, 10)
}
const splitValues = (value) => value.split(":::").map((item) => item.trim()).filter((item) => item)

const contactOf = (values) => {
    const problems = []
    const scalars = {}
    const slots = {email: {}, phone: {}, address: {}, website: {}}
    for (const [column, target] of Object.entries(mapping)) {
        if (!target) continue
        const raw = values[column]
        if (raw == null || String(raw).trim() === "") continue
        const value = String(raw).trim()
        const colon = target.indexOf(":")
        const path = colon < 0 ? target : target.substring(0, colon)
        const fixedPurpose = colon < 0 ? null : target.substring(colon + 1)
        const slotMatch = /^(email|phone|address|website)(\d+)(?:\.([A-Za-z0-9]+))?$/.exec(path)
        if (slotMatch) {
            const kindSlots = slots[slotMatch[1]]
            const slot = kindSlots[slotMatch[2]] || (kindSlots[slotMatch[2]] = {})
            const part = slotMatch[3] || "value"
            slot[part] = slot[part] ? `${slot[part]} ${value}` : value
            if (fixedPurpose) slot.purposeId = fixedPurpose
            continue
        }
        scalars[path] = scalars[path] ? `${scalars[path]}${path === "notes" ? "\n" : " "}${value}` : value
    }
    const ordered = (kindSlots) => Object.keys(kindSlots).sort((a, b) => Number(a) - Number(b)).map((key) => kindSlots[key])

    let firstName = scalars.firstName || null
    let lastName = scalars.lastName || null
    if (!firstName && !lastName && scalars.fullName) {
        const words = scalars.fullName.split(/\s+/)
        firstName = words.length > 1 ? words.slice(0, -1).join(" ") : words[0]
        lastName = words.length > 1 ? words[words.length - 1] : null
    }
    const organizationName = scalars.organizationName || null

    const emails = []
    const emailSlots = ordered(slots.email)
    const hasMarkedPrimary = emailSlots.some((slot) => String(slot.label || "").trim().startsWith("*"))
    for (const slot of emailSlots) {
        for (const address of splitValues(slot.value || "")) {
            const primary = hasMarkedPrimary ? String(slot.label || "").trim().startsWith("*") : emails.length === 0
            const purposeId = slot.purposeId || (primary && !emails.some((email) => email.contactMechPurposeId === "EmailPrimary") ? "EmailPrimary" : "EmailOther")
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) problems.push(`Email ${address} is not a valid address`)
            emails.push({emailAddress: address, contactMechPurposeId: purposeId})
        }
    }
    const phones = []
    for (const slot of ordered(slots.phone)) {
        for (const number of splitValues(slot.value || "")) {
            const purposeId = slot.purposeId || phonePurposes[labelText(slot.label)] || (phones.length === 0 ? "PhonePrimary" : "Other")
            const parsed = parsePhone(number)
            if (!parsed.contactNumber) { problems.push(`Phone ${number} has no number and is left out`); continue }
            phones.push(Object.assign(parsed, {contactMechPurposeId: purposeId}))
        }
    }
    const addresses = []
    for (const slot of ordered(slots.address)) {
        const formattedLines = slot.formatted ? slot.formatted.split(/\r?\n/).map((line) => line.trim()).filter((line) => line) : []
        const address1 = slot.street || (slot.poBox ? `PO Box ${slot.poBox}` : null) || formattedLines[0] || null
        if (!address1) { if (slot.city || slot.postalCode) problems.push("An address without a street is left out"); continue }
        const address = {address1: address1, address2: slot.street2 || (slot.street && slot.poBox ? `PO Box ${slot.poBox}` : null),
            city: slot.city || null, postalCode: slot.postalCode || null, countryGeoId: null, stateProvinceGeoId: null,
            contactMechPurposeId: slot.purposeId || postalPurposes[labelText(slot.label)] || (addresses.length === 0 ? "PostalPrimary" : "PostalGeneral")}
        const countryText = slot.country || defaultCountryGeoId || null
        if (countryText) {
            address.countryGeoId = countryGeoIdOf(countryText)
            if (!address.countryGeoId) problems.push(`Country ${countryText} is not known and is left out`)
        }
        if (slot.region) {
            address.stateProvinceGeoId = address.countryGeoId ? regionGeoIdOf(slot.region, address.countryGeoId) : null
            if (!address.stateProvinceGeoId) problems.push(`Region ${slot.region} is not known${address.countryGeoId ? "" : " without a country"} and is left out`)
        }
        addresses.push(address)
    }
    const websites = []
    for (const slot of ordered(slots.website)) for (const url of splitValues(slot.value || "")) websites.push({webAddress: url, contactMechPurposeId: "WebUrlPrimary"})

    // groups: Google's labels (" ::: " between them, "* myContacts" its own, "* starred" a favorite), Outlook's
    // categories (";" between them), or commas
    let isFavorite = false
    const groupNames = []
    for (const group of String(scalars.groups || "").split(/:::|;|,/).map((item) => item.trim()).filter((item) => item)) {
        if (group.startsWith("*")) { if (/starred/i.test(group)) isFavorite = true; continue }
        if (!groupNames.some((existing) => existing.toLowerCase() === group.toLowerCase())) groupNames.push(group)
    }

    let empty = false
    if (!firstName && !lastName && !organizationName) {
        if (emails.length) {
            firstName = emails[0].emailAddress.split("@")[0]
            problems.push("No name: the email address's name part is used")
        } else if (phones.length) {
            firstName = [phones[0].areaCode, phones[0].contactNumber].filter((part) => part).join(" ")
            problems.push("No name: the phone number is used")
        } else {
            empty = true
            problems.push("Nothing to import: no name, organization, email or phone")
        }
    }
    const birthDate = scalars.birthday ? parseBirthday(scalars.birthday, problems) : null
    const isPerson = !!(firstName || lastName)
    const contact = {partyTypeEnumId: isPerson ? "PtyPerson" : "PtyOrganization", firstName: firstName, middleName: scalars.middleName || null,
        lastName: lastName, personalTitle: scalars.prefix || null, suffix: scalars.suffix || null, nickname: scalars.nickname || null,
        organizationName: organizationName, jobTitle: [scalars.jobTitle, scalars.department].filter((part) => part).join(", ") || null,
        birthDate: birthDate, comments: scalars.notes || null, emails: emails, phones: phones, addresses: addresses, websites: websites,
        groupNames: groupNames, isFavorite: isFavorite}
    return {contact: contact, problems: problems, empty: empty}
}

rows.slice(0, sampleCount).forEach((values, index) => {
    const read = contactOf(values)
    contactList.push({rowNumber: index + 1, values: values, contact: read.contact, problems: read.problems, empty: read.empty})
})
