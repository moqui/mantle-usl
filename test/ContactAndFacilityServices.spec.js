// Party and facility contact services, and the facility services: none of the ported flows reach most of them.
// New spec, no Groovy original.
const effectiveTime = Date.now()
let partyId, postalId, telecomId, emailId, webId, otherId, facilityId, facilityPostalId, facilityLocationSeqId

spec({
    stepwise: true,
    tempSequences: { start: 56200, banks: { "mantle.party.Party": 10, "mantle.party.contact.ContactMech": 20,
        "mantle.facility.Facility": 10 } },
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    return null
}

feature("create contact mechs for a person", {
    when() {
        partyId = call("mantle.party.PartyServices.create#Person", { firstName: "Cora", lastName: "Contact" }).partyId
        postalId = call("mantle.party.ContactServices.create#PostalAddress", { partyId, contactMechPurposeId: "PostalPrimary",
                address1: "1 Main St", city: "Orem", stateProvinceGeoId: "USA_UT", postalCode: "84057", countryGeoId: "USA" }).contactMechId
        telecomId = call("mantle.party.ContactServices.create#TelecomNumber", { partyId, contactMechPurposeId: "PhonePrimary",
                countryCode: "1", areaCode: "801", contactNumber: "555-0100" }).contactMechId
        emailId = call("mantle.party.ContactServices.create#EmailAddress", { partyId, contactMechPurposeId: "EmailPrimary",
                emailAddress: "cora@example.com" }).contactMechId
        webId = call("mantle.party.ContactServices.create#WebAddress", { partyId, contactMechPurposeId: "WebUrlPrimary",
                webAddress: "https://example.com/cora" }).contactMechId
        otherId = call("mantle.party.ContactServices.create#ContactMechOther", { partyId, contactMechPurposeId: "Other",
                contactMechTypeEnumId: "CmtElectronicAddress", infoString: "@cora" }).contactMechId
        return { ids: [postalId, telecomId, emailId, webId, otherId] }
    },
    then({ ids }) { ids.every(id => id != null) },
})

feature("get PartyContactInfo, PartyContactInfoList, PrimaryEmailAddress and PartyDefaultBilling", {
    when() {
        const info = call("mantle.party.ContactServices.get#PartyContactInfo", { partyId, postalContactMechPurposeId: "PostalPrimary",
                telecomContactMechPurposeId: "PhonePrimary", emailContactMechPurposeId: "EmailPrimary",
                webContactMechPurposeId: "WebUrlPrimary", otherContactMechPurposeId: "Other" })
        const list = call("mantle.party.ContactServices.get#PartyContactInfoList", { partyId, getAll: true })
        const primary = call("mantle.party.ContactServices.get#PrimaryEmailAddress", { partyId })
        const billing = call("mantle.party.ContactServices.get#PartyDefaultBilling", { partyId })
        // a party with no contact info at all
        const bare = call("mantle.party.PartyServices.create#Person", { firstName: "Bare", lastName: "Party" }).partyId
        const bareInfo = call("mantle.party.ContactServices.get#PartyContactInfo", { partyId: bare,
                postalContactMechPurposeId: "PostalPrimary", telecomContactMechPurposeId: "PhonePrimary", emailContactMechPurposeId: "EmailPrimary" })
        const bareList = call("mantle.party.ContactServices.get#PartyContactInfoList", { partyId: bare, getAll: true })
        const barePrimary = call("mantle.party.ContactServices.get#PrimaryEmailAddress", { partyId: bare })
        return { info, list, primary, billing, bareInfo, bareList, barePrimary }
    },
    then({ info, list, primary, billing, bareInfo, bareList, barePrimary }) {
        info.postalContactMechId == postalId
        info.postalAddress.city == "Orem"
        info.telecomContactMechId == telecomId
        info.telecomNumber.contactNumber == "555-0100"
        info.emailAddress == "cora@example.com"
        info.webAddress == "https://example.com/cora"
        info.otherInfoString == "@cora"
        list.postalAddressList.length == 1
        list.telecomNumberList.length == 1
        list.emailAddressList.length == 1
        list.webAddressList.length == 1
        primary.emailAddress == "cora@example.com"
        primary.contactMechId == emailId
        billing.postalContactMechId == postalId
        billing.telecomContactMechId == telecomId
        billing.emailContactMechId == emailId
        bareInfo.postalContactMechId == null
        bareInfo.emailAddress == null
        bareList.postalAddressList == null
        barePrimary.emailAddress == null
    },
})

feature("update PartyPostalAddress, PartyTelecomNumber and PartyContactOther", {
    when() {
        const newPostal = call("mantle.party.ContactServices.update#PartyPostalAddress", { partyId, contactMechId: postalId,
                contactMechPurposeId: "PostalPrimary", address1: "2 Second St", city: "Provo", stateProvinceGeoId: "USA_UT",
                postalCode: "84601", countryGeoId: "USA" }).contactMechId
        const newTelecom = call("mantle.party.ContactServices.update#PartyTelecomNumber", { partyId, contactMechId: telecomId,
                contactMechPurposeId: "PhonePrimary", countryCode: "1", areaCode: "385", contactNumber: "555-0101" }).contactMechId
        const newOther = call("mantle.party.ContactServices.update#PartyContactOther", { partyId, contactMechId: otherId,
                contactMechPurposeId: "Other", infoString: "@cora2" }).contactMechId
        const info = call("mantle.party.ContactServices.get#PartyContactInfo", { partyId, postalContactMechPurposeId: "PostalPrimary",
                telecomContactMechPurposeId: "PhonePrimary", otherContactMechPurposeId: "Other" })
        postalId = newPostal; telecomId = newTelecom; otherId = newOther
        return { info }
    },
    then({ info }) {
        info.postalAddress.address1 == "2 Second St"
        info.postalAddress.city == "Provo"
        info.telecomNumber.areaCode == "385"
        info.otherInfoString == "@cora2"
    },
})

feature("findOrCreate contact mechs finds the existing one and creates a missing one", {
    when() {
        const samePostal = call("mantle.party.ContactServices.findOrCreate#PartyPostalAddress", { partyId, contactMechPurposeId: "PostalBilling",
                address1: "2 Second St", city: "Provo", stateProvinceGeoId: "USA_UT", postalCode: "84601", countryGeoId: "USA" }).contactMechId
        const newPostal = call("mantle.party.ContactServices.findOrCreate#PartyPostalAddress", { partyId, contactMechPurposeId: "PostalBilling",
                address1: "9 Other Rd", city: "Lehi", stateProvinceGeoId: "USA_UT", postalCode: "84043", countryGeoId: "USA" }).contactMechId
        const sameEmail = call("mantle.party.ContactServices.findOrCreate#PartyEmailAddress", { partyId, emailAddress: "cora@example.com",
                contactMechPurposeId: "EmailPrimary" }).contactMechId
        const newEmail = call("mantle.party.ContactServices.findOrCreate#PartyEmailAddress", { partyId, emailAddress: "cora.billing@example.com",
                contactMechPurposeId: "EmailBilling" }).contactMechId
        const newPhone = call("mantle.party.ContactServices.findOrCreate#PartyTelecomNumber", { partyId, countryCode: "1", areaCode: "801",
                contactNumber: "555-0199", contactMechPurposeId: "PhoneWork" }).contactMechId
        return { samePostal, newPostal, sameEmail, newEmail, newPhone }
    },
    then({ samePostal, newPostal, sameEmail, newEmail, newPhone }) {
        samePostal != null
        newPostal != postalId
        sameEmail == emailId
        newEmail != emailId
        newPhone != telecomId
    },
})

feature("store, delete and undelete PartyContactMech, update ContactMechMutable", {
    when() {
        call("mantle.party.ContactServices.update#ContactMechMutable", { contactMechId: emailId, trustLevelEnumId: "CmtlVerified" })
        const verified = ec.entity.find("mantle.party.contact.ContactMech").condition("contactMechId", emailId).one()
        call("mantle.party.ContactServices.store#PartyContactMech", { partyId, contactMechId: emailId, contactMechPurposeId: "EmailOther" })
        const added = ec.entity.find("mantle.party.contact.PartyContactMech").condition("partyId", partyId)
                .condition("contactMechId", emailId).condition("contactMechPurposeId", "EmailOther").list()
        call("mantle.party.ContactServices.delete#PartyContactMech", { partyId, contactMechId: emailId, contactMechPurposeId: "EmailOther" })
        const deleted = ec.entity.find("mantle.party.contact.PartyContactMech").condition("partyId", partyId)
                .condition("contactMechId", emailId).condition("contactMechPurposeId", "EmailOther").list()
        const fromDate = deleted[0].fromDate
        call("mantle.party.ContactServices.undelete#PartyContactMech", { partyId, contactMechId: emailId, contactMechPurposeId: "EmailOther", fromDate })
        const restored = ec.entity.find("mantle.party.contact.PartyContactMech").condition("partyId", partyId)
                .condition("contactMechId", emailId).condition("contactMechPurposeId", "EmailOther").list()
        return { verified, added, deleted, restored }
    },
    then({ verified, added, deleted, restored }) {
        verified.trustLevelEnumId == "CmtlVerified"
        added.length == 1
        deleted.length == 1
        deleted[0].thruDate != null
        restored.length == 1
        restored[0].thruDate == null
    },
})

feature("create Facility with contact info and get Facility", {
    when() {
        facilityId = call("mantle.facility.FacilityServices.create#Facility", { facilityName: "Contact Warehouse", facilityTypeEnumId: "FcTpWarehouse",
                ownerPartyId: "ORG_ZIZI_RETAIL", address1: "100 Dock Rd", city: "Orem", stateProvinceGeoId: "USA_UT", postalCode: "84057",
                countryGeoId: "USA", areaCode: "801", contactNumber: "555-0200", emailAddress: "dock@example.com" }).facilityId
        const out = call("mantle.facility.FacilityServices.get#Facility", { facilityId })
        return { out }
    },
    then({ out }) {
        facilityId != null
        out.facilityName == "Contact Warehouse"
        out.address1 == "100 Dock Rd"
        out.contactNumber == "555-0200"
        out.emailAddress == "dock@example.com"
    },
})

feature("update Facility, get FacilitiesByOwner, create FacilityLocation and FacilityNote", {
    when() {
        call("mantle.facility.FacilityServices.update#Facility", { facilityId, facilityName: "Contact Warehouse 2", address1: "101 Dock Rd",
                city: "Orem", stateProvinceGeoId: "USA_UT", postalCode: "84057", countryGeoId: "USA", areaCode: "801", contactNumber: "555-0201" })
        const out = call("mantle.facility.FacilityServices.get#Facility", { facilityId })
        const owned = call("mantle.facility.FacilityServices.get#FacilitiesByOwner", { ownerPartyId: "ORG_ZIZI_RETAIL" })
        facilityLocationSeqId = call("mantle.facility.FacilityServices.create#FacilityLocation", { facilityId, areaId: "A", aisleId: "01",
                sectionId: "02", levelId: "03", positionId: "04", locationTypeEnumId: "FltPick" }).locationSeqId
        call("mantle.facility.FacilityServices.create#FacilityNote", { facilityId, noteText: "Dock door 3 is jammed" })
        const notes = ec.entity.find("mantle.facility.FacilityNote").condition("facilityId", facilityId).list()
        const scanned = call("mantle.facility.FacilityServices.get#ScannedIdGeneral", { facilityId, scanId: facilityLocationSeqId })
        return { out, owned, notes, scanned }
    },
    then({ out, owned, notes, scanned }) {
        out.facilityName == "Contact Warehouse 2"
        out.address1 == "101 Dock Rd"
        out.contactNumber == "555-0201"
        owned.resultList.some(f => f.facilityId == facilityId)
        facilityLocationSeqId != null
        notes.length == 1
        notes[0].noteText == "Dock door 3 is jammed"
        scanned.facilityId == facilityId
    },
})

feature("Facility contact info services", {
    when() {
        const origin = call("mantle.facility.ContactServices.get#FacilityDefaultShipOrigin", { facilityId })
        const dest = call("mantle.facility.ContactServices.get#FacilityDefaultShipDest", { facilityId })
        const info = call("mantle.facility.ContactServices.get#FacilityContactInfo", { facilityId, postalContactMechPurposeId: "PostalPrimary",
                telecomContactMechPurposeId: "PhonePrimary", emailContactMechPurposeId: "EmailPrimary" })
        facilityPostalId = info.postalContactMechId
        const newPostal = call("mantle.facility.ContactServices.update#FacilityPostalAddress", { facilityId, contactMechId: facilityPostalId,
                contactMechPurposeId: "PostalPrimary", address1: "102 Dock Rd", city: "Orem", stateProvinceGeoId: "USA_UT", postalCode: "84057",
                countryGeoId: "USA" }).contactMechId
        const newTelecom = call("mantle.facility.ContactServices.update#FacilityTelecomNumber", { facilityId, contactMechId: info.telecomContactMechId,
                contactMechPurposeId: "PhonePrimary", countryCode: "1", areaCode: "801", contactNumber: "555-0202" }).contactMechId
        const after = call("mantle.facility.ContactServices.get#FacilityContactInfo", { facilityId, postalContactMechPurposeId: "PostalPrimary",
                telecomContactMechPurposeId: "PhonePrimary" })
        call("mantle.facility.ContactServices.delete#FacilityContactMech", { facilityId, contactMechId: newTelecom, contactMechPurposeId: "PhonePrimary" })
        const gone = call("mantle.facility.ContactServices.get#FacilityContactInfo", { facilityId, telecomContactMechPurposeId: "PhonePrimary",
                defaultToPrimaryPurpose: false })
        return { origin, dest, info, newPostal, after, gone }
    },
    then({ origin, dest, info, newPostal, after, gone }) {
        info.postalContactMechId != null
        info.emailAddress == "dock@example.com"
        newPostal != null
        after.postalAddress.address1 == "102 Dock Rd"
        after.telecomNumber.contactNumber == "555-0202"
        gone.telecomContactMechId == null
    },
})

feature("update the other contact info of a facility by purpose", {
    when() {
        const first = call("mantle.facility.ContactServices.update#FacilityContactOther", { facilityId, infoString: "dock-line", contactMechPurposeId: "EmailPrimary" })
        const second = call("mantle.facility.ContactServices.update#FacilityContactOther", { facilityId, infoString: "dock-line-2", contactMechPurposeId: "EmailPrimary" })
        const open = Array.from(ec.entity.find("mantle.facility.FacilityContactMech").condition("facilityId", facilityId).condition("contactMechPurposeId", "EmailPrimary").condition("thruDate", null).list())
        return { first, second, open }
    },
    then({ first, second, open }) {
        first.contactMechId != null
        second.contactMechId != first.contactMechId
        // the older association was expired
        open.length == 1
        open[0].contactMechId == second.contactMechId
    },
})

feature("a facility certification document is stored and its record updated", {
    when() {
        const certId = call("create#mantle.facility.FacilityCertification", { facilityId, otherCertId: "CERT-1" }).facilityCertificationId
        call("mantle.facility.FacilityServices.update#FacilityCertification", { facilityCertificationId: certId, auditScore: "95", documentFile: uploadedFile("cert.txt", "certified") })
        const cert = ec.entity.find("mantle.facility.FacilityCertification").condition("facilityCertificationId", certId).one()
        return { cert }
    },
    then({ cert }) {
        cert.auditScore == "95"
        cert.documentLocation.includes("cert.txt")
    },
})
