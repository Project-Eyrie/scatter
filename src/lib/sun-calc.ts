// Sun position calculator using standard solar equations for azimuth, altitude, sunrise, and sunset

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

// Julian date from a JS Date
function toJulian(date: Date): number {
	return date.getTime() / 86400000 + 2440587.5;
}

// Solar mean anomaly
function solarMeanAnomaly(d: number): number {
	return RAD * (357.5291 + 0.98560028 * d);
}

// Ecliptic longitude
function eclipticLongitude(M: number): number {
	const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
	const P = RAD * 102.9372;
	return M + C + P + Math.PI;
}

// Computes the sun's declination angle from days since J2000
function sunDeclination(d: number): number {
	const M = solarMeanAnomaly(d);
	const L = eclipticLongitude(M);
	return Math.asin(Math.sin(RAD * 23.4393) * Math.sin(L));
}

// Right ascension
function sunRightAscension(d: number): number {
	const M = solarMeanAnomaly(d);
	const L = eclipticLongitude(M);
	return Math.atan2(Math.sin(L) * Math.cos(RAD * 23.4393), Math.cos(L));
}

// Sidereal time
function siderealTime(d: number, lw: number): number {
	return RAD * (280.16 + 360.9856235 * d) - lw;
}

// Hour angle
function hourAngle(theta: number, ra: number): number {
	return theta - ra;
}

// Altitude angle
function altitude(H: number, phi: number, dec: number): number {
	return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
}

// Azimuth angle
function azimuth(H: number, phi: number, dec: number): number {
	return Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
}

export interface SunPosition {
	azimuth: number;
	altitude: number;
}

export interface SunTimes {
	sunrise: Date;
	sunset: Date;
	goldenHourStart: Date;
	goldenHourEnd: Date;
}

const J0 = 0.0009;

// Computes the Julian cycle number for a given day and longitude
function julianCycle(d: number, lw: number): number {
	return Math.round(d - J0 - lw / (2 * Math.PI));
}

// Approximates the solar transit time from hour angle, longitude, and cycle
function approxTransit(Ht: number, lw: number, n: number): number {
	return J0 + (Ht + lw) / (2 * Math.PI) + n;
}

// Computes the Julian date of solar transit from approximation, anomaly, and longitude
function solarTransitJ(ds: number, M: number, L: number): number {
	return 2451545 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
}

// Computes the hour angle at which the sun reaches a given altitude
function hourAngleForAltitude(h: number, phi: number, dec: number): number {
	return Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
}

// Computes the Julian date of sunset for a given altitude threshold
function getSetJ(h: number, lw: number, phi: number, dec: number, n: number, M: number, L: number): number {
	const w = hourAngleForAltitude(h, phi, dec);
	const a = approxTransit(w, lw, n);
	return solarTransitJ(a, M, L);
}

// Calculate sun position for a given date, latitude, longitude
export function getSunPosition(date: Date, lat: number, lng: number): SunPosition {
	const lw = RAD * -lng;
	const phi = RAD * lat;
	const d = toJulian(date) - 2451545;

	const dec = sunDeclination(d);
	const ra = sunRightAscension(d);
	const theta = siderealTime(d, lw);
	const H = hourAngle(theta, ra);

	const alt = altitude(H, phi, dec) * DEG;
	let az = azimuth(H, phi, dec) * DEG + 180;
	if (az < 0) az += 360;
	if (az >= 360) az -= 360;

	return { azimuth: az, altitude: alt };
}

// Calculate sunrise and sunset times
export function getSunTimes(date: Date, lat: number, lng: number): SunTimes {
	const lw = RAD * -lng;
	const phi = RAD * lat;

	const d = toJulian(date) - 2451545;
	const n = julianCycle(d, lw);
	const ds = approxTransit(0, lw, n);

	const M = solarMeanAnomaly(ds);
	const L = eclipticLongitude(M);
	const dec = Math.asin(Math.sin(RAD * 23.4393) * Math.sin(L));

	const Jnoon = solarTransitJ(ds, M, L);

	const h0 = RAD * -0.833;
	const h1 = RAD * 6;

	// Converts a Julian date to a JavaScript Date object
	function fromJulian(j: number): Date {
		return new Date((j - 2440587.5) * 86400000);
	}

	let Jset: number, Jrise: number, JgoldenEnd: number, JgoldenStart: number;

	try {
		Jset = getSetJ(h0, lw, phi, dec, n, M, L);
		Jrise = Jnoon - (Jset - Jnoon);
		JgoldenStart = getSetJ(h1, lw, phi, dec, n, M, L);
		JgoldenEnd = Jnoon - (JgoldenStart - Jnoon);
	} catch {
		const noon = fromJulian(Jnoon);
		return {
			sunrise: noon,
			sunset: noon,
			goldenHourStart: noon,
			goldenHourEnd: noon
		};
	}

	return {
		sunrise: fromJulian(Jrise),
		sunset: fromJulian(Jset),
		goldenHourStart: fromJulian(JgoldenStart),
		goldenHourEnd: fromJulian(JgoldenEnd)
	};
}
