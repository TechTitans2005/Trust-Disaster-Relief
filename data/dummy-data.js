const beneficiaries = [
  { id: "RH-KHP-7F92A1", name: "Fatima Bibi", village: "Village A", members: 6, status: "Verified", lastAid: "Food package", registeredAt: "2026-09-20T08:15:00.000Z" },
  { id: "RH-KHP-882A91", name: "Fatema Bibi", village: "Village B", members: 6, status: "Pending", lastAid: null, registeredAt: "2026-09-28T10:40:00.000Z" },
  { id: "RH-KHP-3C10D4", name: "Ghulam Hussain", village: "Village C", members: 5, status: "Verified", lastAid: "Water", registeredAt: "2026-09-18T11:20:00.000Z" },
  { id: "RH-KHP-91B7E2", name: "Zainab Khatoon", village: "Village A", members: 8, status: "Verified", lastAid: "Shelter kit", registeredAt: "2026-09-16T07:55:00.000Z" },
  { id: "RH-KHP-5D44A0", name: "Imran Shaikh", village: "Village B", members: 4, status: "Verified", lastAid: "Medicine", registeredAt: "2026-09-15T09:05:00.000Z" },
  { id: "RH-KHP-A21F68", name: "Sakina Mai", village: "Village D", members: 7, status: "Pending", lastAid: "Food package", registeredAt: "2026-09-29T14:30:00.000Z" },
  { id: "RH-KHP-17E3B9", name: "Abdul Rehman", village: "Village C", members: 3, status: "Verified", lastAid: "Water", registeredAt: "2026-09-14T12:10:00.000Z" },
  { id: "RH-KHP-60C9F5", name: "Mehrunisa", village: "Village D", members: 5, status: "Verified", lastAid: "Shelter kit", registeredAt: "2026-09-12T16:45:00.000Z" }
];

const firstNames = ["Ayesha", "Naseem", "Parveen", "Razia", "Shazia", "Sughra", "Akhtar", "Bashir", "Habib", "Jameel", "Khadim", "Manzoor", "Nisar", "Saleem", "Yousuf", "Zubaida"];
const lastNames = ["Bibi", "Khatoon", "Shaikh", "Memon", "Soomro", "Abbasi", "Chandio", "Leghari"];
const villages = ["Kot Diji", "Gambat", "Sobhodero", "Kingri", "Faiz Ganj", "Nara"];
const aidTypes = ["Food package", "Water", "Shelter kit", "Medicine", null];

for (let index = 0; index < 48; index += 1) {
  const suffix = (0x110000 + index * 7919).toString(16).toUpperCase().slice(-6);
  beneficiaries.push({
    id: `RH-KHP-${suffix}`,
    name: `${firstNames[index % firstNames.length]} ${lastNames[(index * 3) % lastNames.length]}`,
    village: villages[index % villages.length],
    members: 2 + (index % 9),
    status: index % 5 === 0 ? "Pending" : "Verified",
    lastAid: aidTypes[index % aidTypes.length],
    registeredAt: new Date(Date.UTC(2026, 8, 1 + (index % 28), 7 + (index % 8), index % 60)).toISOString()
  });
}

const aidTotals = {
  "Food package": 12410,
  Water: 9120,
  "Shelter kit": 5230,
  Medicine: 4444
};

const coverage = [
  { village: "Village A", families: 217, verified: 163, relocated: 19, shelter: 132, x: 25, y: 30 },
  { village: "Village B", families: 143, verified: 91, relocated: 13, shelter: 44, x: 42, y: 48 },
  { village: "Village C", families: 98, verified: 79, relocated: 8, shelter: 71, x: 61, y: 27 },
  { village: "Village D", families: 120, verified: 88, relocated: 17, shelter: 59, x: 73, y: 62 },
  { village: "Kot Diji", families: 188, verified: 152, relocated: 24, shelter: 118, x: 47, y: 72 },
  { village: "Gambat", families: 166, verified: 139, relocated: 11, shelter: 101, x: 33, y: 61 },
  { village: "Sobhodero", families: 132, verified: 101, relocated: 16, shelter: 69, x: 18, y: 68 },
  { village: "Kingri", families: 111, verified: 82, relocated: 9, shelter: 48, x: 67, y: 43 },
  { village: "Faiz Ganj", families: 105, verified: 78, relocated: 14, shelter: 39, x: 81, y: 35 },
  { village: "Nara", families: 94, verified: 63, relocated: 21, shelter: 28, x: 85, y: 71 }
];

const relocations = [
  { id: "REL-2001", reliefId: "RH-KHP-91B7E2", previousLocation: "Kot Diji", currentLocation: "Village A", date: "2026-09-25T09:30:00.000Z", verificationStatus: "Verified", actor: "field.worker" },
  { id: "REL-2002", reliefId: "RH-KHP-A21F68", previousLocation: "Village A", currentLocation: "Village D", date: "2026-09-27T12:10:00.000Z", verificationStatus: "Pending", actor: "field.worker" },
  { id: "REL-2003", reliefId: "RH-KHP-60C9F5", previousLocation: "Village B", currentLocation: "Village D", date: "2026-09-18T14:25:00.000Z", verificationStatus: "Verified", actor: "verifier.sana" },
  { id: "REL-2004", reliefId: "RH-KHP-110000", previousLocation: "Village A", currentLocation: "Kot Diji", date: "2026-09-22T10:15:00.000Z", verificationStatus: "Verified", actor: "field.worker" }
];

module.exports = { beneficiaries, aidTotals, coverage, relocations };
