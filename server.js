import express from 'express';
import webpack from 'webpack';
import webpackDevMiddleware from 'webpack-dev-middleware';
import webpackConfig from './webpack.config.js';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { parse } from 'csv-parse';

// Constants for calculations
const EARTH_RADIUS = 6371000; // meters
const EARTH_MASS = 5.97e24;   // kg
const SOLAR_LUMINOSITY = 3.828e26; // watts
const AU_TO_METERS = 1.496e11;     // 1 AU in meters
const PI = Math.PI;
const STEFAN_BOLTZMANN = 5.670374419e-8;  // Stefan-Boltzmann constant in W⋅m−2⋅K−4
const SOLAR_RADIUS = 6.957e8;             // meters

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const compiler = webpack(webpackConfig);
let startTime;

app.use(webpackDevMiddleware(compiler, {
    publicPath: webpackConfig.output.publicPath,
}));

app.use(express.static(path.join(__dirname, 'public')));

// Function to convert coordinates if needed
function convertCoordinatesToDecimal(ra, dec) {
    if (typeof ra === 'string' && ra.includes(':')) {
        const [hours, minutes, seconds] = ra.split(':').map(Number);
        ra = (hours + minutes/60 + seconds/3600) * 15; // Convert to degrees
    }
    if (typeof dec === 'string' && dec.includes(':')) {
        const [degrees, minutes, seconds] = dec.split(':').map(Number);
        const sign = degrees < 0 || dec.startsWith('-') ? -1 : 1;
        dec = sign * (Math.abs(degrees) + minutes/60 + seconds/3600);
    }
    return { ra: parseFloat(ra), dec: parseFloat(dec) };
}

async function fetchNASAData(query) {
    const url = `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=${encodeURIComponent(query)}&format=json`;
    console.log('Fetching data from:', url);
    
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`NASA API responded with status: ${response.status}`);
    }
    
    return await response.json();
}

async function fetchExoEUData() {
    try {
        console.log('Fetching data from exoplanet.eu...');
        const response = await fetch('https://exoplanet.eu/catalog/csv');
        if (!response.ok) {
            throw new Error(`exoplanet.eu responded with status: ${response.status}`);
        }

        const csvText = await response.text();
        
        // Log first few lines to check column names
        console.log('First few lines of EU CSV:');
        console.log(csvText.split('\n').slice(0, 2).join('\n'));
        
        return new Promise((resolve, reject) => {
            parse(csvText, {
                columns: true,
                skip_empty_lines: true,
                trim: true
            }, (err, data) => {
                if (err) reject(err);
                else {
                    if (data && data.length > 0) {
                        console.log('EU CSV columns:', Object.keys(data[0]));
                        
                        // Log some sample data
                        const sampleEntry = data[0];
                        console.log('Sample EU data entry:', {
                            star_name: sampleEntry.star_name,
                            name: sampleEntry.name,
                            molecules: sampleEntry.molecules  // Changed from detected_molecules
                        });
                    }
                    resolve(data);
                }
            });
        });
    } catch (error) {
        console.error('Error fetching exoplanet.eu data:', error);
        return null;
    }
}

function verifyStarMatch(star1, star2) {
    // First check if names are similar
    if (!areStarNamesSimilar(star1.name || star1.hostname, star2.name || star2.hostname)) {
        return false;
    }
    
    // If coordinates are available, verify they match within tolerance
    if (star1.ra && star1.dec && star2.ra && star2.dec) {
        if (!areCoordinatesClose(star1.ra, star1.dec, star2.ra, star2.dec)) {
            console.log(`Coordinate mismatch for similar names: ${star1.name || star1.hostname} vs ${star2.name || star2.hostname}`);
            return false;
        }
    }
    
    // Additional verification checks
    if (star1.sy_dist && star2.sy_dist) {
        const distRatio = Math.max(star1.sy_dist, star2.sy_dist) / Math.min(star1.sy_dist, star2.sy_dist);
        if (distRatio > 1.5) {  // Allow 50% difference in distance
            return false;
        }
    }

    return true;
}

function areCoordinatesClose(ra1, dec1, ra2, dec2, maxDistance = 0.05) {
    if (!ra1 || !dec1 || !ra2 || !dec2) return false;
    
    // Convert coordinates to radians
    const ra1Rad = ra1 * Math.PI / 180;
    const dec1Rad = dec1 * Math.PI / 180;
    const ra2Rad = ra2 * Math.PI / 180;
    const dec2Rad = dec2 * Math.PI / 180;
    
    // Calculate angular separation using the Haversine formula
    const deltaRa = ra2Rad - ra1Rad;
    const deltaDec = dec2Rad - dec1Rad;
    
    const a = Math.sin(deltaDec/2) * Math.sin(deltaDec/2) +
              Math.cos(dec1Rad) * Math.cos(dec2Rad) * 
              Math.sin(deltaRa/2) * Math.sin(deltaRa/2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = c * 180 / Math.PI;  // Convert back to degrees
    
    return distance <= maxDistance;
}

function handlePotentialDuplicate(euStar, nasaData) {
    for (const nasaStar of nasaData) {
        // First verify if this is truly the same star
        if (verifyStarMatch(
            {
                name: euStar.star_name,
                ra: parseFloat(euStar.ra),
                dec: parseFloat(euStar.dec),
                sy_dist: parseFloat(euStar.star_distance)
            },
            {
                name: nasaStar.hostname,
                ra: parseFloat(nasaStar.ra),
                dec: parseFloat(nasaStar.dec),
                sy_dist: parseFloat(nasaStar.sy_dist)
            }
        )) {
            console.log(`Verified match: ${euStar.star_name} = ${nasaStar.hostname}`);
            
            // List of fields to check and merge
            const fieldsToMerge = {
                'star_distance': 'sy_dist',
                'star_teff': 'st_teff',
                'star_radius': 'st_rad',
                'star_mass': 'st_mass',
                'star_luminosity': 'st_lum',
                'star_sp_type': 'st_spectype'
            };

            // Keep track of what fields were updated
            const updatedFields = [];

            // Merge stellar data
            for (const [euField, nasaField] of Object.entries(fieldsToMerge)) {
                if (nasaStar[nasaField] === null || nasaStar[nasaField] === undefined) {
                    const euValue = parseFloat(euStar[euField]);
                    if (!isNaN(euValue)) {
                        nasaStar[nasaField] = euValue;
                        updatedFields.push(nasaField);
                    }
                }
            }

            if (updatedFields.length > 0) {
                console.log(`Updated fields for ${nasaStar.hostname}:`, updatedFields.join(', '));
            }

            return { 
                isDuplicate: true, 
                updatedNasaStar: nasaStar,
                updatedFields: updatedFields
            };
        }
    }
    return { isDuplicate: false };
}

function calculateDensity(mass, radius) {
    if (!mass || !radius) return null;
    const volume = (4/3) * PI * Math.pow(radius * EARTH_RADIUS, 3);
    return (mass * EARTH_MASS) / volume;
}

function calculateInsolation(starLuminosity, semiMajorAxis) {
    if (!starLuminosity || !semiMajorAxis) return null;
    return (starLuminosity * SOLAR_LUMINOSITY) / (4 * PI * Math.pow(semiMajorAxis * AU_TO_METERS, 2));
}

function consolidateStellarData(stellarEntries) {
    if (!stellarEntries || stellarEntries.length === 0) return null;
    let consolidated = { ...stellarEntries[0] };
    stellarEntries.forEach(entry => {
        ['st_teff', 'st_rad', 'st_mass', 'st_lum', 'st_spectype', 'sy_dist'].forEach(field => {
            if (!consolidated[field] && entry[field]) {
                consolidated[field] = entry[field];
            }
        });
    });
    return consolidated;
}

function normalizeStarName(name) {
    if (!name) return '';
    let normalized = name.toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

    // Simple prefix standardization for common catalogs
    const prefixes = {
        '^hd\\s*': 'hd ',
        '^gj\\s*': 'gj ',
        '^hr\\s*': 'hr ',
        '^hip\\s*': 'hip ',
        '^bd\\s*': 'bd ',
        '^gl\\s*': 'gj ',  // Convert gl to gj
        '^gliese\\s*': 'gj ',
        '^wolf\\s*': 'wolf ',
        '^lhs\\s*': 'lhs ',
        '^2mass\\s*': '2mass '
    };

    // Apply prefix standardization
    for (const [pattern, replacement] of Object.entries(prefixes)) {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(normalized)) {
            normalized = normalized.replace(regex, replacement);
            break;  // Only apply one prefix replacement
        }
    }

    // Handle Greek letters
    const greekLetters = {
        'alpha': 'alf', 'β': 'bet', 'gamma': 'gam',
        'delta': 'del', 'epsilon': 'eps', 'zeta': 'zet',
        'eta': 'eta', 'theta': 'the', 'iota': 'iot',
        'kappa': 'kap', 'lambda': 'lam', 'mu': 'mu',
        'nu': 'nu', 'xi': 'xi', 'omicron': 'omi',
        'pi': 'pi', 'rho': 'rho', 'sigma': 'sig',
        'tau': 'tau', 'upsilon': 'ups', 'phi': 'phi',
        'chi': 'chi', 'psi': 'psi', 'omega': 'ome'
    };

    // Apply Greek letter standardization
    for (const [full, abbrev] of Object.entries(greekLetters)) {
        normalized = normalized.replace(new RegExp(`\\b${full}\\b`, 'gi'), abbrev);
    }

    // Remove common suffixes
    normalized = normalized.replace(/\s*[ab]\b|\s+[12]\b|\s+i+\b/gi, '');

    return normalized;
}

// Cache for name matching results
const nameMatchCache = new Map();

function areStarNamesSimilar(name1, name2) {
    if (!name1 || !name2) return false;
    
    // Check cache first
    const cacheKey = `${name1}|${name2}`;
    if (nameMatchCache.has(cacheKey)) {
        return nameMatchCache.get(cacheKey);
    }

    const norm1 = normalizeStarName(name1);
    const norm2 = normalizeStarName(name2);

    // Direct match
    if (norm1 === norm2) {
        nameMatchCache.set(cacheKey, true);
        return true;
    }

    // Check if one is a substring of the other
    const isMatch = norm1.includes(norm2) || norm2.includes(norm1);
    nameMatchCache.set(cacheKey, isMatch);
    return isMatch;
}

function createNameVariants(name) {
    if (!name) return new Set();
    const normalized = normalizeStarName(name);
    const variants = new Set([name, normalized]);
    
    if (normalized.startsWith('hd ')) {
        variants.add('HD' + normalized.slice(3));
        variants.add('HD ' + normalized.slice(3));
    }
    if (normalized.startsWith('gj ')) {
        variants.add('GJ' + normalized.slice(3));
        variants.add('GJ ' + normalized.slice(3));
        variants.add('Gliese' + normalized.slice(3));
        variants.add('Gliese ' + normalized.slice(3));
        variants.add('GL ' + normalized.slice(3));
        variants.add('GL' + normalized.slice(3));
    }
    
    return variants;
}

function areNamesMatching(name1, name2) {
    if (!name1 || !name2) return false;
    const variants1 = createNameVariants(name1);
    const variants2 = createNameVariants(name2);
    
    for (const v1 of variants1) {
        for (const v2 of variants2) {
            if (v1 === v2) return true;
        }
    }
    return false;
}

class NameMatchingSystem {
    constructor() {
        this.nameMap = new Map();
        this.alternateMap = new Map();
    }

    addName(primaryName, alternateNames = []) {
        if (!primaryName) return;
        
        const normalizedPrimary = normalizeStarName(primaryName);
        this.nameMap.set(normalizedPrimary, primaryName);
        
        createNameVariants(primaryName).forEach(variant => {
            this.alternateMap.set(variant, primaryName);
        });

        alternateNames.forEach(altName => {
            if (altName) {
                createNameVariants(altName).forEach(variant => {
                    this.alternateMap.set(variant, primaryName);
                });
            }
        });
    }

    findMatch(name) {
        if (!name) return null;
        const normalized = normalizeStarName(name);
        
        // Direct match
        if (this.nameMap.has(normalized)) {
            return this.nameMap.get(normalized);
        }
        
        // Alternate match
        if (this.alternateMap.has(normalized)) {
            return this.alternateMap.get(normalized);
        }
        
        // Try variants
        for (const [variant, primary] of this.alternateMap) {
            if (areNamesMatching(name, variant)) {
                return primary;
            }
        }
        
        return null;
    }
}

function calculateStellarLuminosity(star) {
    // If we already have luminosity, return it
    if (star.st_lum !== null && star.st_lum !== undefined) {
        return star.st_lum;
    }

    try {
        // Method 1: Stefan-Boltzmann law using temperature and radius
        if (star.st_teff && star.st_rad) {
            const radiusInMeters = star.st_rad * SOLAR_RADIUS;
            const luminosity = 4 * Math.PI * Math.pow(radiusInMeters, 2) * 
                             STEFAN_BOLTZMANN * Math.pow(star.st_teff, 4);
            return luminosity / SOLAR_LUMINOSITY;
        }

        // Method 2: Mass-Luminosity relation
        if (star.st_mass) {
            if (star.st_mass < 0.43) {
                return Math.pow(star.st_mass, 2.3);
            } else if (star.st_mass < 2) {
                return Math.pow(star.st_mass, 4);
            } else if (star.st_mass < 20) {
                return Math.pow(star.st_mass, 3.5);
            } else {
                return Math.pow(star.st_mass, 2);
            }
        }

        // Method 3: Spectral type estimation
        if (star.st_spectype) {
            const spectralClass = star.st_spectype.charAt(0).toUpperCase();
            const spectralNumber = parseInt(star.st_spectype.match(/\d+/)?.[0] || '5');
            
            switch(spectralClass) {
                case 'O': return 100000 * (1 - spectralNumber/10);
                case 'B': return 1000 * (1 - spectralNumber/10);
                case 'A': return 100 * (1 - spectralNumber/10);
                case 'F': return 10 * (1 - spectralNumber/10);
                case 'G': return 1 * (1 - spectralNumber/10);
                case 'K': return 0.1 * (1 - spectralNumber/10);
                case 'M': return 0.01 * (1 - spectralNumber/10);
                default: return null;
            }
        }

        return null;

    } catch (error) {
        console.error('Error calculating stellar luminosity:', error);
        return null;
    }
}

function parseValue(value) {
    if (value === null || value === '') return null;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
}

function createNewStar(hostname, starData) {
    const star = {
        hostname: hostname,
        ra: parseValue(starData.ra),
        dec: parseValue(starData.dec),
        sy_dist: parseValue(starData.sy_dist),
        st_teff: parseValue(starData.st_teff),
        st_rad: parseValue(starData.st_rad),
        st_mass: parseValue(starData.st_mass),
        st_lum: parseValue(starData.st_lum),
        st_spectype: starData.st_spectype,
        planets: new Map(),
        dataSource: 'EU',
        dataFields: {
            nasa: new Set(),
            eu: new Set(),
            calculated: new Set()
        }
    };

    // Calculate luminosity if missing
    if (star.st_lum === null) {
        star.st_lum = calculateStellarLuminosity(star);
        if (star.st_lum !== null) {
            star.dataFields.calculated.add('st_lum');
        }
    }

    return star;
}

function mergeStarData(existingStar, newData, dataSource) {
    let updatesCount = 0;
    const fieldsToMerge = {
        'sy_dist': 'star_distance',
        'st_teff': 'star_teff',
        'st_rad': 'star_radius',
        'st_mass': 'star_mass',
        'st_lum': 'star_luminosity',
        'st_spectype': 'star_sp_type'
    };

    // Ensure dataFields exists and has all required sets
    if (!existingStar.dataFields) {
        existingStar.dataFields = {
            nasa: new Set(),
            eu: new Set(),
            calculated: new Set()
        };
    }

    // Ensure all required sets exist
    if (!existingStar.dataFields.nasa) existingStar.dataFields.nasa = new Set();
    if (!existingStar.dataFields.eu) existingStar.dataFields.eu = new Set();
    if (!existingStar.dataFields.calculated) existingStar.dataFields.calculated = new Set();

    Object.entries(fieldsToMerge).forEach(([nasaField, euField]) => {
        if (!existingStar[nasaField] && newData[euField]) {
            const value = nasaField === 'st_spectype' ? 
                newData[euField] : 
                parseFloat(newData[euField]);
            
            if (nasaField === 'st_spectype' && value) {
                existingStar[nasaField] = value;
                existingStar.dataFields[dataSource].add(nasaField);
                updatesCount++;
            } else if (nasaField !== 'st_spectype' && !isNaN(value)) {
                existingStar[nasaField] = value;
                existingStar.dataFields[dataSource].add(nasaField);
                updatesCount++;
            }
        }
    });

    // Update source if we made changes
    if (updatesCount > 0 && existingStar.dataSource === 'NASA') {
        existingStar.dataSource = 'BOTH';
    }

    // Ensure we have a planets array if it doesn't exist
    if (!existingStar.planets) {
        existingStar.planets = [];
    }

    return updatesCount;
}

function mapExoEUData(euData, existingStars, nasaData) {  
    const mappedData = {};
    let stats = {
        totalConfirmedPlanets: 0,
        newPlanetsAdded: 0,
        newStarsAdded: 0,
        skippedNoCoords: 0,
        skippedDuplicateStars: 0,
        planetMatchedByName: 0,
        planetMatchedByAltName: 0,
        starMatchedByName: 0,
        starMatchedByAltName: 0,
        coordinateBasedDuplicates: 0,
        dataUpdates: 0,
        planetsWithMolecules: 0
    };

    // Create name matching system
    const nameSystem = new NameMatchingSystem();
    
    // Initialize with NASA data
    nasaData.forEach(star => {
        nameSystem.addName(star.hostname);
    });

    // Pre-process NASA data for faster lookups
    const nasaStarMap = new Map();
    nasaData.forEach(star => {
        nasaStarMap.set(normalizeStarName(star.hostname), star);
    });

    const moleculeStats = {
        uniqueMolecules: new Set(),
        totalMolecules: 0
    };

    euData.forEach(entry => {
        if (!entry.star_name || !entry.name || entry.planet_status !== 'Confirmed') {
            return;
        }
        stats.totalConfirmedPlanets++;

        const hostname = entry.star_name;
        const normalizedName = normalizeStarName(hostname);
        const coords = convertCoordinatesToDecimal(entry.ra, entry.dec);
        
        if (!coords.ra || !coords.dec) {
            stats.skippedNoCoords++;
            return;
        }

        // Log molecule data if present
        if (entry.molecules) {
            console.log(`Found molecules for ${entry.name}:`, entry.molecules);
        }

        // Try to find matching NASA star
        let matchedNasaStar = null;
        let matchType = null;

        // First try direct name matching
        const nameMatch = nameSystem.findMatch(hostname);
        if (nameMatch) {
            matchedNasaStar = nasaStarMap.get(normalizeStarName(nameMatch));
            if (matchedNasaStar) {
                stats.starMatchedByName++;
                matchType = 'name';
            }
        }

        // If no name match, try coordinate matching
        if (!matchedNasaStar) {
            for (const nasaStar of nasaData) {
                if (areCoordinatesClose(coords.ra, coords.dec, parseFloat(nasaStar.ra), parseFloat(nasaStar.dec))) {
                    if (verifyStarMatch(
                        {
                            name: hostname,
                            ra: coords.ra,
                            dec: coords.dec,
                            sy_dist: parseFloat(entry.star_distance)
                        },
                        {
                            name: nasaStar.hostname,
                            ra: nasaStar.ra,
                            dec: nasaStar.dec,
                            sy_dist: nasaStar.sy_dist
                        }
                    )) {
                        matchedNasaStar = nasaStar;
                        stats.coordinateBasedDuplicates++;
                        matchType = 'coordinates';
                        break;
                    }
                }
            }
        }

        if (matchedNasaStar) {
            stats.skippedDuplicateStars++;
            // Merge data instead of skipping
            const updates = mergeStarData(matchedNasaStar, {
                star_distance: entry.star_distance,
                star_teff: entry.star_teff,
                star_radius: entry.star_radius,
                star_mass: entry.star_mass,
                star_luminosity: entry.star_luminosity,
                star_sp_type: entry.star_sp_type
            }, 'eu');
            
            if (updates > 0) {
                stats.dataUpdates += updates;
                if (matchedNasaStar.dataSource === 'NASA') {
                    matchedNasaStar.dataSource = 'BOTH';
                }
            }

            // Add any new planets not already present
            const planet = {
                pl_name: entry.name,
                pl_orbsmax: parseFloat(entry.semi_major_axis) || null,
                pl_rade: parseFloat(entry.radius) || null,
                pl_masse: parseFloat(entry.mass) || null,
                pl_bmasse: parseFloat(entry.mass_sini) || null,
                pl_orbeccen: parseFloat(entry.eccentricity) || null,
                pl_eqt: parseFloat(entry.temp_calculated) || null,
                pl_dens: null,
                pl_insol: null,
                pl_orbper: parseFloat(entry.orbital_period) || null,
                molecules: entry.molecules ? 
                    entry.molecules.split(',')
                        .map(m => m.trim())
                        .filter(m => m && m.length > 0) : [],
                dataSource: 'EU',
                dataFields: {
                    nasa: new Set(),
                    eu: new Set(entry.molecules ? ['molecules'] : [])
                }
            };

            // Update molecule statistics
            if (planet.molecules && planet.molecules.length > 0) {
                stats.planetsWithMolecules++;
                planet.molecules.forEach(m => moleculeStats.uniqueMolecules.add(m));
                moleculeStats.totalMolecules += planet.molecules.length;
                console.log(`Processed molecules for ${planet.pl_name}:`, planet.molecules);
            }

            // Calculate derived properties
            if (planet.pl_masse && planet.pl_rade) {
                planet.pl_dens = calculateDensity(planet.pl_masse, planet.pl_rade);
            }
            if (matchedNasaStar.st_lum && planet.pl_orbsmax) {
                planet.pl_insol = calculateInsolation(matchedNasaStar.st_lum, planet.pl_orbsmax);
            }

            planet.pl_type = determinePlanetType(planet);

            if (!matchedNasaStar.planets.some(p => areNamesMatching(p.pl_name, planet.pl_name))) {
                matchedNasaStar.planets.push(planet);
                stats.newPlanetsAdded++;
            }

            return;
        }

        // Create new star if not a duplicate
        if (!mappedData[hostname]) {
            mappedData[hostname] = {
                hostname: hostname,
                ra: coords.ra,
                dec: coords.dec,
                sy_dist: parseFloat(entry.star_distance) || null,
                st_teff: parseFloat(entry.star_teff) || null,
                st_rad: parseFloat(entry.star_radius) || null,
                st_mass: parseFloat(entry.star_mass) || null,
                st_lum: parseFloat(entry.star_luminosity) || null,
                st_spectype: entry.star_sp_type || null,
                planets: [],
                dataSource: 'EU',
                dataFields: {
                    nasa: new Set(),
                    eu: new Set(),
                    calculated: new Set()
                },
                alternateNames: entry.star_alternate_names ? 
                    entry.star_alternate_names.split(',').map(n => n.trim()) : []
            };

            nameSystem.addName(hostname, mappedData[hostname].alternateNames);

            if (mappedData[hostname].st_lum === null) {
                mappedData[hostname].st_lum = calculateStellarLuminosity(mappedData[hostname]);
                if (mappedData[hostname].st_lum !== null) {
                    mappedData[hostname].dataFields.calculated.add('st_lum');
                }
            }

            stats.newStarsAdded++;
        }

        // Create and add planet for new star
        const planet = {
            pl_name: entry.name,
            pl_orbsmax: parseFloat(entry.semi_major_axis) || null,
            pl_rade: parseFloat(entry.radius) || null,
            pl_masse: parseFloat(entry.mass) || null,
            pl_bmasse: parseFloat(entry.mass_sini) || null,
            pl_orbeccen: parseFloat(entry.eccentricity) || null,
            pl_eqt: parseFloat(entry.temp_calculated) || null,
            pl_dens: null,
            pl_insol: null,
            pl_orbper: parseFloat(entry.orbital_period) || null,
            molecules: entry.molecules ? 
                entry.molecules.split(',')
                    .map(m => m.trim())
                    .filter(m => m && m.length > 0) : [],
            dataSource: 'EU',
            dataFields: {
                nasa: new Set(),
                eu: new Set(entry.molecules ? ['molecules'] : [])
            }
        };

        // Update molecule statistics for new planet
        if (planet.molecules && planet.molecules.length > 0) {
            stats.planetsWithMolecules++;
            planet.molecules.forEach(m => moleculeStats.uniqueMolecules.add(m));
            moleculeStats.totalMolecules += planet.molecules.length;
        }

        // Calculate derived properties
        if (planet.pl_masse && planet.pl_rade) {
            planet.pl_dens = calculateDensity(planet.pl_masse, planet.pl_rade);
        }

        const star = mappedData[hostname];
        if (star.st_lum && planet.pl_orbsmax) {
            planet.pl_insol = calculateInsolation(star.st_lum, planet.pl_orbsmax);
        }

        planet.pl_type = determinePlanetType(planet);

        if (!mappedData[hostname].planets.some(p => areNamesMatching(p.pl_name, planet.pl_name))) {
            mappedData[hostname].planets.push(planet);
            stats.newPlanetsAdded++;
        }
    });

    // Add molecule statistics to the summary
    console.log('\nMolecule Data Summary:');
    console.log('----------------------');
    console.log(`Planets with molecular data: ${stats.planetsWithMolecules}`);
    console.log(`Unique molecules found: ${moleculeStats.uniqueMolecules.size}`);
    console.log(`Total molecule detections: ${moleculeStats.totalMolecules}`);
    console.log('Molecules found:', Array.from(moleculeStats.uniqueMolecules).join(', '));

    console.log('\nDetailed Matching Summary:');
    console.log('-------------------------');
    console.log(`Planets matched by direct name: ${stats.planetMatchedByName}`);
    console.log(`Planets matched by alternate name: ${stats.planetMatchedByAltName}`);
    console.log(`Stars matched by direct name: ${stats.starMatchedByName}`);
    console.log(`Stars matched by alternate name: ${stats.starMatchedByAltName}`);
    console.log(`Coordinate-based duplicates found: ${stats.coordinateBasedDuplicates}`);
    console.log(`Data fields updated: ${stats.dataUpdates}`);
    console.log('\nEU Data Processing Summary:');
    console.log('---------------------------');
    console.log(`Total confirmed planets found: ${stats.totalConfirmedPlanets}`);
    console.log(`Skipped due to missing coordinates: ${stats.skippedNoCoords}`);
    console.log(`New stars added: ${stats.newStarsAdded}`);
    console.log(`New planets added: ${stats.newPlanetsAdded}`);

    return mappedData;
}

function consolidateExoplanetData(rawData, euData = null) {
    const starMap = new Map();
    const nameSystem = new NameMatchingSystem();
    let stats = {
        existingPlanets: 0,
        euPlanetsAdded: 0,
        duplicatesSkipped: 0,
        dataUpdates: 0,
        nasaOnlyStars: 0,
        euOnlyStars: 0,
        bothSourcesStars: 0,
        planetsWithMolecules: 0
    };

    // Track molecule statistics
    const moleculeStats = {
        uniqueMolecules: new Set(),
        totalMolecules: 0
    };

    // Process NASA data first
    const processedPlanets = new Set();
    rawData.forEach(row => {
        const starKey = row.hostname;
        
        if (!starMap.has(starKey)) {
            const star = {
                hostname: row.hostname,
                ra: parseValue(row.ra),
                dec: parseValue(row.dec),
                sy_dist: parseValue(row.sy_dist),
                st_teff: parseValue(row.st_teff),
                st_rad: parseValue(row.st_rad),
                st_mass: parseValue(row.st_mass),
                st_lum: parseValue(row.st_lum),
                st_spectype: row.st_spectype,
                planets: [],
                dataSource: 'NASA',
                dataFields: {
                    nasa: new Set(),
                    eu: new Set(),
                    calculated: new Set()
                }
            };

            // Calculate luminosity if missing
            if (star.st_lum === null) {
                star.st_lum = calculateStellarLuminosity(star);
                if (star.st_lum !== null) {
                    star.dataFields.calculated.add('st_lum');
                }
            }

            nameSystem.addName(starKey);
            starMap.set(starKey, star);
            stats.nasaOnlyStars++;
        }

        const planetKey = `${row.hostname}_${row.pl_name}`;
        if (!processedPlanets.has(planetKey)) {
            const planet = {
                pl_name: row.pl_name,
                pl_orbsmax: parseValue(row.pl_orbsmax),
                pl_rade: parseValue(row.pl_rade),
                pl_masse: parseValue(row.pl_masse),
                pl_bmasse: parseValue(row.pl_bmasse),
                pl_orbeccen: parseValue(row.pl_orbeccen),
                pl_eqt: parseValue(row.pl_eqt),
                pl_dens: parseValue(row.pl_dens),
                pl_insol: parseValue(row.pl_insol),
                molecules: [], // Initialize empty molecules array for NASA planets
                dataSource: 'NASA',
                dataFields: { nasa: new Set(), eu: new Set() }
            };

            planet.pl_type = determinePlanetType(planet);
            starMap.get(starKey).planets.push(planet);
            processedPlanets.add(planetKey);
            stats.existingPlanets++;
        }
    });

    // Process EU data
    if (euData) {
        Object.entries(euData).forEach(([hostname, starData]) => {
            const normalizedName = normalizeStarName(hostname);
            const matchedName = nameSystem.findMatch(hostname);
            
            if (matchedName) {
                // Update existing star
                const existingStar = starMap.get(matchedName);
                if (existingStar) {
                    const updates = mergeStarData(existingStar, starData, 'eu');
                    if (updates > 0) {
                        stats.nasaOnlyStars--;
                        stats.bothSourcesStars++;
                        if (existingStar.dataSource === 'NASA') {
                            existingStar.dataSource = 'BOTH';
                        }
                    }

                    // Merge planets with molecule preservation
                    starData.planets.forEach(euPlanet => {
                        const existingPlanet = existingStar.planets.find(p => 
                            areNamesMatching(p.pl_name, euPlanet.pl_name));
                        
                        if (existingPlanet) {
                            // Update molecules if available from EU data
                            if ((!existingPlanet.molecules || existingPlanet.molecules.length === 0) && 
                                euPlanet.molecules && euPlanet.molecules.length > 0) {
                                existingPlanet.molecules = euPlanet.molecules;
                                existingPlanet.dataFields.eu.add('molecules');
                                
                                // Update molecule statistics
                                stats.planetsWithMolecules++;
                                euPlanet.molecules.forEach(m => moleculeStats.uniqueMolecules.add(m));
                                moleculeStats.totalMolecules += euPlanet.molecules.length;
                                
                                console.log(`Added molecules to existing planet ${existingPlanet.pl_name}:`, 
                                    existingPlanet.molecules);
                            }
                        } else {
                            // Add new planet with molecules
                            if (euPlanet.molecules && euPlanet.molecules.length > 0) {
                                stats.planetsWithMolecules++;
                                euPlanet.molecules.forEach(m => moleculeStats.uniqueMolecules.add(m));
                                moleculeStats.totalMolecules += euPlanet.molecules.length;
                                console.log(`Adding new EU planet with molecules ${euPlanet.pl_name}:`, 
                                    euPlanet.molecules);
                            }
                            existingStar.planets.push(euPlanet);
                            stats.euPlanetsAdded++;
                        }
                    });
                }
            } else {
                // Check for coordinate-based matches
                let hasCoordinateMatch = false;
                for (const [_, existingStar] of starMap) {
                    if (areCoordinatesClose(starData.ra, starData.dec, existingStar.ra, existingStar.dec)) {
                        hasCoordinateMatch = true;
                        // Merge data with existing star
                        const updates = mergeStarData(existingStar, starData, 'eu');
                        if (updates > 0) {
                            stats.nasaOnlyStars--;
                            stats.bothSourcesStars++;
                            if (existingStar.dataSource === 'NASA') {
                                existingStar.dataSource = 'BOTH';
                            }
                        }
                        
                        // Merge planets with molecule preservation
                        starData.planets.forEach(euPlanet => {
                            if (!existingStar.planets.some(p => areNamesMatching(p.pl_name, euPlanet.pl_name))) {
                                if (euPlanet.molecules && euPlanet.molecules.length > 0) {
                                    stats.planetsWithMolecules++;
                                    euPlanet.molecules.forEach(m => moleculeStats.uniqueMolecules.add(m));
                                    moleculeStats.totalMolecules += euPlanet.molecules.length;
                                }
                                existingStar.planets.push(euPlanet);
                                stats.euPlanetsAdded++;
                            }
                        });
                        break;
                    }
                }

                if (!hasCoordinateMatch) {
                    // Add new star system
                    // Update molecule statistics for new star's planets
                    let hasMolecules = false;
                    starData.planets.forEach(planet => {
                        if (planet.molecules && planet.molecules.length > 0) {
                            hasMolecules = true;
                            stats.planetsWithMolecules++;
                            planet.molecules.forEach(m => moleculeStats.uniqueMolecules.add(m));
                            moleculeStats.totalMolecules += planet.molecules.length;
                        }
                    });

                    if (hasMolecules) {
                        console.log(`Adding new EU star ${hostname} with planets containing molecules`);
                    }

                    starMap.set(hostname, {
                        ...starData,
                        planets: [...starData.planets]
                    });
                    stats.euOnlyStars++;
                }
            }
        });
    }

    // Add final molecule statistics
    console.log('\nFinal Molecule Data Status:');
    console.log('-------------------------');
    console.log(`Total planets with molecules: ${stats.planetsWithMolecules}`);
    console.log(`Total unique molecules found: ${moleculeStats.uniqueMolecules.size}`);
    console.log(`Total molecule detections: ${moleculeStats.totalMolecules}`);
    if (moleculeStats.uniqueMolecules.size > 0) {
        console.log('All molecules found:', Array.from(moleculeStats.uniqueMolecules).join(', '));
    }

    return Array.from(starMap.values());
}

app.get('/api/exoplanets', async (req, res) => {
    startTime = Date.now();
    try {
        const psQuery = `
            SELECT pl_name, hostname, ra, dec, sy_dist, 
                   st_teff, st_rad, st_mass, st_lum, st_spectype,
                   pl_orbsmax, pl_rade, pl_masse, pl_bmasse, 
                   pl_orbeccen, pl_eqt, pl_dens, pl_insol
            FROM ps
            WHERE soltype = 'Published Confirmed'
            ORDER BY hostname
        `;
        
        const stellarQuery = `
            SELECT hostname, st_teff, st_rad, st_mass, st_lum, 
                   st_spectype, sy_dist
            FROM stellarhosts
            ORDER BY hostname
        `;

        console.log('\nFetching data from all sources...');
        const [planetaryData, stellarData, euData] = await Promise.all([
            fetchNASAData(psQuery),
            fetchNASAData(stellarQuery),
            fetchExoEUData()
        ]);

        console.log(`Fetched ${planetaryData.length} planetary entries from NASA`);
        console.log(`Fetched ${stellarData.length} stellar entries from NASA`);
        
        // Create set of existing stars
        const existingStars = new Set(planetaryData.map(p => p.hostname));
        console.log(`Found ${existingStars.size} unique stars in NASA data`);

        // Map EU data, filtering for new stars with valid coordinates
        const mappedEUData = euData ? mapExoEUData(euData, existingStars, planetaryData) : null;

        // Group stellar data by hostname
        const stellarDataByHost = stellarData.reduce((acc, entry) => {
            if (!acc[entry.hostname]) {
                acc[entry.hostname] = [];
            }
            acc[entry.hostname].push(entry);
            return acc;
        }, {});

        // Create consolidated stellar data
        const consolidatedStellarData = {};
        Object.entries(stellarDataByHost).forEach(([hostname, entries]) => {
            consolidatedStellarData[hostname] = consolidateStellarData(entries);
        });

        // Merge NASA data
        const mergedData = planetaryData.map(planet => {
            const stellarInfo = consolidatedStellarData[planet.hostname];
            if (stellarInfo) {
                ['st_teff', 'st_rad', 'st_mass', 'st_lum', 'st_spectype', 'sy_dist'].forEach(field => {
                    if (!planet[field] && stellarInfo[field]) {
                        planet[field] = stellarInfo[field];
                    }
                });
            }
            return planet;
        });

        let consolidatedData = consolidateExoplanetData(mergedData, mappedEUData);

        // Filter out stars without distance values
        console.log('\nRemoving stars with missing distances...');
        const originalCount = consolidatedData.length;
        consolidatedData = consolidatedData.filter(star => 
            star.sy_dist !== null && 
            star.sy_dist !== undefined && 
            !isNaN(star.sy_dist));
        const removedCount = originalCount - consolidatedData.length;

        console.log(`Removed ${removedCount} stars without distance data`);
        console.log(`Final dataset contains ${consolidatedData.length} stars`);

        // Recalculate statistics after filtering
        const totalStars = consolidatedData.length;
        const nullCounts = {
            sy_dist: 0, // Will always be 0 after filtering
            st_lum: 0,
            st_mass: 0,
            st_rad: 0
        };
        const sourceStats = {
            nasa: 0,
            eu: 0,
            both: 0
        };

        const starChecked = new Set();
        consolidatedData.forEach(data => {
            if (!starChecked.has(data.hostname)) {
                // Count missing values (except distance, which we've filtered out)
                if (data.st_lum === null || data.st_lum === undefined) nullCounts.st_lum++;
                if (data.st_mass === null || data.st_mass === undefined) nullCounts.st_mass++;
                if (data.st_rad === null || data.st_rad === undefined) nullCounts.st_rad++;
                
                // Track data sources
                if (data.dataSource === 'NASA') sourceStats.nasa++;
                else if (data.dataSource === 'EU') sourceStats.eu++;
                else sourceStats.both++;
                
                starChecked.add(data.hostname);
            }
        });

        // Final statistics report
        const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log('\nProcessing completed in', processingTime, 'seconds');

        console.log('\nFinal Data Completeness Report (After Distance Filter):');
        console.log('------------------------------------------------');
        console.log(`Total unique stars: ${totalStars}`);
        console.log('\nData Source Distribution:');
        console.log(`NASA only: ${sourceStats.nasa} stars`);
        console.log(`EU only: ${sourceStats.eu} stars`);
        console.log(`Both sources: ${sourceStats.both} stars`);
        console.log('\nMissing Data Counts:');
        console.log(`Distance (sy_dist): 0 stars (0.00%)`);
        console.log(`Luminosity (st_lum): ${nullCounts.st_lum} stars (${((nullCounts.st_lum/totalStars)*100).toFixed(2)}%)`);
        console.log(`Mass (st_mass): ${nullCounts.st_mass} stars (${((nullCounts.st_mass/totalStars)*100).toFixed(2)}%)`);
        console.log(`Radius (st_rad): ${nullCounts.st_rad} stars (${((nullCounts.st_rad/totalStars)*100).toFixed(2)}%)`);
        console.log('------------------------------------------------\n');

        res.json(consolidatedData);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'An error occurred while fetching data', details: error.message });
    }
});

function determinePlanetType(planet) {
    const {
        pl_rade,     // Planet radius (Earth radii)
        pl_masse,    // Planet mass (Earth masses)
        pl_bmasse,   // Planet mass*sin(i) (Earth masses)
        pl_orbsmax,  // Semi-major axis (AU)
        pl_eqt,      // Equilibrium temperature (K)
        pl_dens,     // Density (g/cm³)
        pl_insol     // Insolation flux (Earth flux)
    } = planet;

    // Get the best available mass measurement
    const planetMass = pl_masse || pl_bmasse; // Use direct mass if available, otherwise use mass*sin(i)

    // If we don't have radius and no mass measurements, return Unknown
    if (!pl_rade && !planetMass) {
        return 'Unknown';
    }

    // Helper function to check if a planet is potentially rocky based on density or radius
    const isPotentiallyRocky = () => {
        if (pl_dens) return pl_dens > 3.0; // Use density if available
        if (pl_rade) return pl_rade < 1.6;  // Use radius as fallback
        if (planetMass) return planetMass < 10; // Use mass as last resort
        return false;
    };

    // Helper function to check if planet is in habitable zone
    const isInHabitableZone = () => {
        if (pl_insol) return pl_insol >= 0.25 && pl_insol <= 2.0;
        if (pl_eqt) return pl_eqt >= 200 && pl_eqt <= 300;
        if (pl_orbsmax) {
            // Rough approximation based on orbital distance
            return pl_orbsmax >= 0.95 && pl_orbsmax <= 1.67;
        }
        return false;
    };

    // Classification logic with hierarchy
    // Ultra-hot Jupiters
    if (pl_eqt && pl_eqt > 2000 && ((planetMass && planetMass > 100) || (pl_rade && pl_rade > 8))) {
        return 'Ultra-hot Jupiter';
    }

    // Hot Jupiters
    if (pl_orbsmax && pl_orbsmax < 0.1 && ((planetMass && planetMass > 100) || (pl_rade && pl_rade > 8))) {
        return 'Hot Jupiter';
    }

    // Super-Jovians
    if ((planetMass && planetMass > 635) || (pl_rade && pl_rade > 15)) {
        return 'Super-Jovian';
    }

    // Gas Giants
    if ((planetMass && planetMass > 95) || (pl_rade && pl_rade > 8)) {
        return 'Gas Giant';
    }

    // Mini-Neptunes
    if (pl_rade && pl_rade >= 2 && pl_rade < 4) {
        if (pl_dens && pl_dens < 3.0) {
            return 'Mini-Neptune';
        }
        if (planetMass && planetMass < 20) {
            return 'Mini-Neptune';
        }
    }

    // Super-Earths
    if ((pl_rade && pl_rade >= 1.25 && pl_rade < 2) || (planetMass && planetMass >= 2 && planetMass < 10)) {
        if (isPotentiallyRocky()) {
            if (isInHabitableZone()) {
                return 'Habitable Super-Earth';
            }
            return 'Super-Earth';
        }
        return 'Mini-Neptune';
    }

    // Earth-like
    if ((pl_rade && pl_rade >= 0.8 && pl_rade < 1.25) || (planetMass && planetMass >= 0.5 && planetMass < 2)) {
        if (isPotentiallyRocky()) {
            if (isInHabitableZone()) {
                return 'Habitable Earth-like';
            }
            return 'Earth-like';
        }
    }

    // Sub-Earths
    if ((pl_rade && pl_rade < 0.8) || (planetMass && planetMass < 0.5)) {
        if (isPotentiallyRocky()) {
            return 'Sub-Earth';
        }
    }

    // Water Worlds
    if (pl_dens && pl_dens < 3.0 && pl_dens > 1.0 && pl_rade && pl_rade < 4) {
        return 'Ocean World';
    }

    // Lava Worlds
    if (pl_eqt && pl_eqt > 1500 && isPotentiallyRocky()) {
        return 'Lava World';
    }

    // If we have some data but couldn't classify definitively
    if (pl_rade || planetMass) {
        return 'Unclassified';
    }

    return 'Unknown';
}

app.get('/api/planet-spectra/:planetName', (req, res) => {
    const { planetName } = req.params;
    
    const pythonScriptPath = path.join(__dirname, 'exoAtmosSpectra', 'planet_data_viewer.py');
    console.log(`Executing Python script for planet: ${planetName}`);
    console.log(`Python script path: ${pythonScriptPath}`);

    const pythonProcess = spawn('python3', [pythonScriptPath, planetName], {
        cwd: path.join(__dirname, 'exoAtmosSpectra'),
        stdio: 'pipe'
    });

    let dataString = '';
    let errorString = '';

    pythonProcess.stdout.on('data', (data) => {
        dataString += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
        errorString += data.toString();
        console.error(`Python stderr: ${data}`);
    });

    pythonProcess.on('error', (error) => {
        console.error(`Failed to start Python process: ${error}`);
        res.status(500).json({ error: 'Failed to start Python process', details: error.message });
    });

    pythonProcess.on('close', (code) => {
        console.log(`Python script exited with code ${code}`);
        if (code !== 0) {
            console.error(`Python script error output: ${errorString}`);
            return res.status(500).json({ error: 'Python script exited with non-zero code', details: errorString });
        }
        try {
            const spectraData = JSON.parse(dataString);
            res.json(spectraData);
        } catch (error) {
            console.error('Error parsing spectra data:', error);
            res.status(500).json({ error: 'Error processing spectra data', details: dataString });
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));