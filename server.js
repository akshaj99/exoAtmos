import express from 'express';
import webpack from 'webpack';
import webpackDevMiddleware from 'webpack-dev-middleware';
import webpackConfig from './webpack.config.js';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const compiler = webpack(webpackConfig);

app.use(webpackDevMiddleware(compiler, {
    publicPath: webpackConfig.output.publicPath,
}));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/exoplanets', async (req, res) => {
    try {
        const query = `
            SELECT pl_name, hostname, ra, dec, sy_dist, st_teff, st_rad, st_mass, st_lum, st_spectype, pl_orbsmax, pl_rade, pl_masse, pl_orbeccen
            FROM ps
            WHERE soltype = 'Published Confirmed'
            ORDER BY pl_name
        `;

        const url = `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=${encodeURIComponent(query)}&format=json`;

        console.log('Fetching data from NASA Exoplanet Archive...');
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`NASA API responded with status: ${response.status}`);
        }

        const rawData = await response.json();
        console.log(`Fetched ${rawData.length} rows of exoplanet data`);

        // Process and consolidate the data
        const consolidatedData = consolidateExoplanetData(rawData);
        console.log(`Consolidated into ${consolidatedData.length} unique planets`);

        res.json(consolidatedData);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'An error occurred while fetching data', details: error.message });
    }
});


function consolidateExoplanetData(rawData) {
    const starMap = new Map();

    function parseValue(value) {
        if (value === null || value === '') return null;
        const parsed = parseFloat(value);
        return isNaN(parsed) ? null : parsed;
    }

    rawData.forEach(row => {
        const starKey = row.hostname;
        if (!starMap.has(starKey)) {
            starMap.set(starKey, {
                hostname: row.hostname,
                ra: parseValue(row.ra),
                dec: parseValue(row.dec),
                sy_dist: parseValue(row.sy_dist),
                st_teff: parseValue(row.st_teff),
                st_rad: parseValue(row.st_rad),
                st_mass: parseValue(row.st_mass),
                st_lum: parseValue(row.st_lum),
                st_spectype: row.st_spectype,
                planets: new Map()
            });
        }

        const star = starMap.get(starKey);
        
        // Update star properties if they are null and the new row has a value
        ['ra', 'dec', 'sy_dist', 'st_teff', 'st_rad', 'st_mass', 'st_lum', 'st_spectype'].forEach(prop => {
            if (star[prop] === null && row[prop] !== null) {
                star[prop] = prop === 'st_spectype' ? row[prop] : parseValue(row[prop]);
            }
        });

        if (!star.planets.has(row.pl_name)) {
            star.planets.set(row.pl_name, {
                pl_name: row.pl_name,
                pl_orbsmax: parseValue(row.pl_orbsmax),
                pl_rade: parseValue(row.pl_rade),
                pl_masse: parseValue(row.pl_masse),
                pl_orbeccen: parseValue(row.pl_orbeccen)
            });
        } else {
            // Update planet properties if they are null and the new row has a value
            const planet = star.planets.get(row.pl_name);
            ['pl_orbsmax', 'pl_rade', 'pl_masse', 'pl_orbeccen'].forEach(prop => {
                if (planet[prop] === null && row[prop] !== null) {
                    planet[prop] = parseValue(row[prop]);
                }
            });
        }
    });

    // Convert planets Map to Array for each star
    for (let [hostname, star] of starMap) {
        star.planets = Array.from(star.planets.values());
    }

    console.log(`Consolidated ${starMap.size} star systems`);
    starMap.forEach((star, hostname) => {
        console.log(`${hostname}: ${star.planets.length} planets`);
    });

    return Array.from(starMap.values());
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

