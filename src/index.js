import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { Group, Tween, Easing } from '@tweenjs/tween.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import LZString from 'lz-string';
import Chart from 'chart.js/auto';
import ChartZoom from 'chartjs-plugin-zoom';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

Chart.register(ChartZoom);

let starSystemScene, starSystemCamera, starSystemRenderer, starSystemControls;
let planets = [];
let isInStarSystemView = false;
let mouseDownObject = null;
let mouseDownTime = 0;
const clickThreshold = 300; // milliseconds
let isOverSearchContainer = false;
let currentSpectraDisplay = null;
const VISIBILITY_THRESHOLD = 4000; // Reduced from 1000
const GALAXY_SIZE = 40000; // Reduced from 200000
let milkyWayMesh;

window.exoplanetState = window.exoplanetState || {
    selectedStar: 'Sun',
    selectedStarIndex: 0,
    cameraPosition: { x: 0, y: 0, z: 200 }
};

let tweenGroup = new Group();
let scene, camera, renderer, controls, raycaster;
let exoplanets = [];
let names = [];
let composer;
let selectedObject = null;

let messageEl1, labelRenderer, centerdist, centerdistly, exoplanetName, exoplanetName2, exoplanetNames, exoplanetDist, exoplanetColor, image, cdsLink, simbad, aladinLink, ned, aladinDiv;

function initializeDOMElements() {
    centerdist = document.getElementById('centerdist');
    centerdistly = document.getElementById('centerdistly');
    exoplanetName = document.getElementById('exoplanetName');
    exoplanetName2 = document.getElementById('exoplanetName2');
    exoplanetNames = document.getElementById('exoplanetNames');
    exoplanetDist = document.getElementById('exoplanetDist');
    exoplanetColor = document.getElementById('exoplanetColor');
    image = document.getElementById('image');
    cdsLink = document.getElementById('cds');
    simbad = document.getElementById('simbad');
    aladinLink = document.getElementById('aladin');
    ned = document.getElementById('ned');
    aladinDiv = document.getElementById('aladin-lite-div');

    console.log('DOM elements initialized:', {
        centerdist: !!centerdist,
        centerdistly: !!centerdistly,
        exoplanetName: !!exoplanetName,
        exoplanetName2: !!exoplanetName2,
        exoplanetNames: !!exoplanetNames,
        exoplanetDist: !!exoplanetDist,
        exoplanetColor: !!exoplanetColor,
        image: !!image,
        cdsLink: !!cdsLink,
        simbad: !!simbad,
        aladinLink: !!aladinLink,
        ned: !!ned,
        aladinDiv: !!aladinDiv
    });
}

let isInitialized = false;

async function initializeScene() {
    if (isInitialized) {
        console.log('Scene already initialized');
        return;
    }

    console.log('Initializing scene...');
    isInitialized = true;

    try {
            console.log('Starting initialization');

            if (!window.exoplanetState) {
                window.exoplanetState = {
                    selectedStar: 'Sun',
                    selectedStarIndex: 0,
                    cameraPosition: { x: 0, y: 0, z: 200 }
                };
            }
            
        
            scene = new THREE.Scene();
            addMilkyWayBackground();
            camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, GALAXY_SIZE * 2);
            camera.position.set(500, 0, 200);
            
            renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.setClearColor('#000000');
            document.body.appendChild(renderer.domElement);

            composer = new EffectComposer(renderer);
            const renderPass = new RenderPass(scene, camera);
            composer.addPass(renderPass);

            const bloomPass = new UnrealBloomPass(
                new THREE.Vector2(window.innerWidth, window.innerHeight),
                1.5,
                0.4,
                0.85
            );
            composer.addPass(bloomPass);

            raycaster = new THREE.Raycaster();
            raycaster.params.Points.threshold = 0.1;

            let data;
            if (isDataStale()) {
                console.log('Data is stale, updating...');
                showDataRefreshMessage('Data is stale, updating...');
                data = await updateLocalData();
                messageEl1.style.display = 'none';
            } else {
                console.log('Using cached data');
                data = JSON.parse(LZString.decompress(localStorage.getItem('exoplanetData')));
            }
            console.log(`Loaded ${data.length} exoplanets`);
            console.log(data);

            let starSystems = processStarSystems(data);
            console.log(`Processed ${Object.keys(starSystems).length} unique star systems`);

            exoplanets = [{x: 0, y: 0, z: 0, hostname: 'Sun'}].concat(Object.values(starSystems));
            names = ['Sun'].concat(Object.keys(starSystems));

            let starGroup = createStarGroup(starSystems);
            scene.add(starGroup);

            console.log(`Added star group with ${starGroup.children.length} objects to the scene`);

            const backgroundStars = createBackgroundStars(1000); // Adjust the number as needed
            scene.add(backgroundStars);
            console.log('Added background stars to the scene');

            controls = new TrackballControls(camera, renderer.domElement);
            controls.minDistance = 0.1;
            controls.maxDistance = GALAXY_SIZE * 0.9;
            controls.zoomSpeed = 3;
            
            const originalUpdate = controls.update;
            controls.update = function() {
                try {
                    originalUpdate.call(this);
                } catch (error) {
                    console.error('Error in controls update:', error);
                }
            };
            initializeDOMElements();
            const searchContainer = document.getElementById('search-container');
            searchContainer.addEventListener('mouseenter', function() {
                isOverSearchContainer = true;
            });
            searchContainer.addEventListener('mouseleave', function() {
                isOverSearchContainer = false;
            });            
            setupEventListeners();

            render();
            
            console.log('Initialization completed');
        } catch (error) {
            console.error('Error in initializeScene:', error);
            isInitialized = false;  // Allow retry on error
        }
}


function addMilkyWayBackground() {
    const loader = new THREE.TextureLoader();
    console.log('Attempting to load Milky Way texture from:', '/images/milky_way.jpg');
    loader.load('/images/milky_way.jpg', 
        (texture) => {
            console.log('Milky Way texture loaded successfully');
            const geometry = new THREE.PlaneGeometry(1, 1);
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    milkyWayTexture: { value: texture },
                    opacity: { value: 0.0 },
                    fadeEdge: { value: 0.1 }, // Controls the size of the fade edge
                },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform sampler2D milkyWayTexture;
                    uniform float opacity;
                    uniform float fadeEdge;
                    varying vec2 vUv;
                    void main() {
                        vec4 texColor = texture2D(milkyWayTexture, vUv);
                        vec2 centeredUv = vUv * 2.0 - 1.0;
                        float dist = length(centeredUv);
                        float circle = 1.0 - smoothstep(1.0 - fadeEdge, 1.0, dist);
                        float fadeOut = smoothstep(0.5, 1.0, dist);
                        gl_FragColor = vec4(texColor.rgb, texColor.a * opacity * circle * (1.0 - fadeOut));
                    }
                `,
                transparent: true,
                depthWrite: false,
                depthTest: false,
                side: THREE.DoubleSide
            });
            milkyWayMesh = new THREE.Mesh(geometry, material);
            milkyWayMesh.scale.set(GALAXY_SIZE, GALAXY_SIZE, 1);
            milkyWayMesh.rotation.y = -Math.PI / 2; // Rotate 90 degrees to the left
            milkyWayMesh.rotation.z = Math.PI / 2 - 0.5;
            scene.add(milkyWayMesh);
            milkyWayMesh.position.set(0, -7000, -4000);
            console.log('Milky Way plane added to scene');
        },
        undefined,
        (error) => {
            console.error('Error loading Milky Way texture:', error);
        }
    );
}

function createPlanet(planet, index, starSize) {
    const planetSize = planet.pl_rade ? Math.max(0.05, planet.pl_rade * 0.009 * starSize) : 0.05 * starSize;
    console.log(`Creating planet: ${planet.pl_name}, Size: ${planetSize}, Orbit: ${planet.pl_orbsmax}, Eccentricity: ${planet.pl_orbeccen}`);
    const planetGeometry = new THREE.SphereGeometry(planetSize, 32, 32);
    const planetMaterial = new THREE.MeshPhongMaterial({ color: 0xFFFFFF });
    const planetMesh = new THREE.Mesh(planetGeometry, planetMaterial);
    
    // Add planet data to mesh directly
    planetMesh.userData.planet = planet;
    
    const scaleFactor = 10;
    const semiMajorAxis = starSize * 5 + (index + 1) * scaleFactor * (planet.pl_orbsmax || 1);
    const eccentricity = planet.pl_orbeccen || 0;
    
    // Create elliptical orbit
    const orbitPoints = [];
    const segments = 128;
    for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        const r = semiMajorAxis * (1 - eccentricity * eccentricity) / (1 + eccentricity * Math.cos(theta));
        const x = r * Math.cos(theta);
        const z = r * Math.sin(theta);
        orbitPoints.push(new THREE.Vector3(x, 0, z));
    }
    const orbitGeometry = new THREE.BufferGeometry().setFromPoints(orbitPoints);
    const orbitMaterial = new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.5 });
    const orbitLine = new THREE.Line(orbitGeometry, orbitMaterial);
    starSystemScene.add(orbitLine);

    starSystemScene.add(planetMesh);
    
    // Create text label for the planet
    const planetLabelDiv = document.createElement('div');
    planetLabelDiv.className = 'planet-label';
    planetLabelDiv.textContent = planet.pl_name;
    planetLabelDiv.style.backgroundColor = 'transparent';
    planetLabelDiv.style.color = 'white';
    planetLabelDiv.style.padding = '2px';
    planetLabelDiv.style.fontSize = '12px';
    planetLabelDiv.style.cursor = 'pointer';
    planetLabelDiv.style.pointerEvents = 'auto';
    
    planetLabelDiv.addEventListener('click', (event) => {
        event.stopPropagation();
        removeSpectraDisplay();
        displayPlanetSpectra(planet.pl_name);
    });

    const planetLabel = new CSS2DObject(planetLabelDiv);
    planetLabel.position.set(planetSize * 1.2, planetSize * 1.2, 0);
    planetMesh.add(planetLabel);

    planets.push({
        mesh: planetMesh,
        label: planetLabel,
        semiMajorAxis: semiMajorAxis,
        eccentricity: eccentricity,
        orbitSpeed: 0.00001 / Math.sqrt(semiMajorAxis),
        data: planet
    });

    return planetMesh;
}

const searchContainer = document.getElementById('search-container');

searchContainer.addEventListener('mouseenter', function() {
    isOverSearchContainer = true;
});

searchContainer.addEventListener('mouseleave', function() {
    isOverSearchContainer = false;
});

function onPlanetClick(event) {
    const planet = event.object.userData.planet;
    console.log(`Clicked on planet: ${planet.pl_name}`);
    removeSpectraDisplay();
    displayPlanetSpectra(planet.pl_name);
}

function addClickListenerToMesh(mesh) {
    mesh.userData.planet = mesh.userData.planet || {};
    mesh.addEventListener('click', onPlanetClick);
}


function removeSpectraDisplay() {
    if (currentSpectraDisplay) {
        currentSpectraDisplay.remove();
        currentSpectraDisplay = null;
    }
}

async function displayPlanetSpectra(planetName) {
    try {
        showDataRefreshMessage(`Loading ${planetName} spectra...`);
        removeSpectraDisplay();

        const response = await fetch(`/api/planet-spectra/${planetName}`);
        const spectraData = await response.json();
        
        if (spectraData.error) {
            console.error(spectraData.error);
            showMessage(`Error: ${spectraData.error}`);
            return;
        }
        
        if (spectraData.message) {
            showMessage(spectraData.message);
            return;
        }
        
        const spectraDiv = document.createElement('div');
        spectraDiv.id = 'spectra-display';
        spectraDiv.style.position = 'fixed';
        spectraDiv.style.right = '10px';
        spectraDiv.style.top = '10px';
        spectraDiv.style.width = '400px';
        spectraDiv.style.maxWidth = 'calc(100% - 20px)';
        spectraDiv.style.maxHeight = 'calc(100% - 20px)';
        spectraDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        spectraDiv.style.color = 'white';
        spectraDiv.style.padding = '10px';
        spectraDiv.style.overflowY = 'auto';
        spectraDiv.style.display = 'flex';
        spectraDiv.style.flexDirection = 'column';
        spectraDiv.style.zIndex = '1000';
        
        spectraDiv.innerHTML = `<h2>${planetName} Spectra</h2>`;
        
        const availableTypes = ['transmission', 'eclipse', 'direct_imaging'].filter(type => spectraData[type] && spectraData[type].length > 0);
        
        if (availableTypes.length === 0) {
            spectraDiv.innerHTML += '<p>No spectral data available for this planet.</p>';
            document.body.appendChild(spectraDiv);
            currentSpectraDisplay = spectraDiv;
            return;
        }

        const typeSelect = document.createElement('select');
        typeSelect.id = 'spectra-type-select';
        typeSelect.style.marginBottom = '10px';
        availableTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type.charAt(0).toUpperCase() + type.slice(1);
            typeSelect.appendChild(option);
        });
        spectraDiv.appendChild(typeSelect);

        const controlsContainer = document.createElement('div');
        controlsContainer.style.display = 'flex';
        controlsContainer.style.justifyContent = 'space-between';
        controlsContainer.style.alignItems = 'center';
        controlsContainer.style.marginBottom = '10px';
        spectraDiv.appendChild(controlsContainer);

        const buttonContainer = document.createElement('div');
        controlsContainer.appendChild(buttonContainer);

        const resetZoomButton = document.createElement('button');
        resetZoomButton.textContent = 'Reset Zoom';
        buttonContainer.appendChild(resetZoomButton);

        const resetSizeButton = document.createElement('button');
        resetSizeButton.textContent = 'Reset Size';
        buttonContainer.appendChild(resetSizeButton);

        const filterSelect = document.createElement('select');
        filterSelect.id = 'reference-filter';
        controlsContainer.appendChild(filterSelect);

        const spectrumContainer = document.createElement('div');
        spectrumContainer.id = 'spectrum-container';
        spectrumContainer.style.position = 'relative';
        spectrumContainer.style.width = '100%';
        spectrumContainer.style.height = '300px';
        spectraDiv.appendChild(spectrumContainer);

        let currentChart = null;

        function createChart(type) {
            if (currentChart) {
                currentChart.destroy();
            }

            spectrumContainer.innerHTML = '';

            const canvas = document.createElement('canvas');
            canvas.id = 'spectrum-canvas';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            spectrumContainer.appendChild(canvas);

            const references = [...new Set(spectraData[type].map(d => d.REFERENCE))];
            filterSelect.innerHTML = `
                <option value="all">All References</option>
                ${references.map(ref => `<option value="${ref}">${ref}</option>`).join('')}
            `;

            currentChart = new Chart(canvas, {
                type: 'scatter',
                data: {
                    datasets: [{
                        label: `${type.charAt(0).toUpperCase() + type.slice(1)} Spectrum`,
                        data: spectraData[type].map(d => ({
                            x: d.CENTRALWAVELNG, 
                            y: d[type === 'transmission' ? 'PL_TRANDEP' : type === 'eclipse' ? 'ESPECLIPDEP' : 'FLAM'],
                            reference: d.REFERENCE
                        })),
                        backgroundColor: 'rgba(255, 99, 132, 0.8)',
                        borderColor: 'rgba(255, 99, 132, 1)',
                        borderWidth: 1,
                        showLine: true,
                        tension: 0.1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: {
                            type: 'linear',
                            position: 'bottom',
                            title: {
                                display: true,
                                text: 'Wavelength (microns)'
                            },
                            ticks: {
                                callback: function(value, index, values) {
                                    return value.toFixed(2);
                                }
                            }
                        },
                        y: {
                            type: 'linear',
                            position: 'left',
                            title: {
                                display: true,
                                text: type === 'direct_imaging' ? 'F_Lambda (W/(m^2 microns))' : 'Depth (%)'
                            },
                            ticks: {
                                callback: function(value, index, values) {
                                    return value.toExponential(2);
                                }
                            }
                        }
                    },
                    plugins: {
                        zoom: {
                            pan: {
                                enabled: true,
                                mode: 'xy',
                            },
                            zoom: {
                                wheel: {
                                    enabled: true,
                                },
                                pinch: {
                                    enabled: true
                                },
                                mode: 'xy',
                            },
                            limits: {
                                x: {min: 'original', max: 'original', minRange: 0.1},
                                y: {min: 'original', max: 'original', minRange: 0.1}
                            }
                        }
                    }
                }
            });

            const resizeHandle = document.createElement('div');
            resizeHandle.style.position = 'absolute';
            resizeHandle.style.left = '0';
            resizeHandle.style.top = '0';
            resizeHandle.style.width = '20px';
            resizeHandle.style.height = '20px';
            resizeHandle.style.cursor = 'nwse-resize';
            resizeHandle.style.display = 'flex';
            resizeHandle.style.justifyContent = 'center';
            resizeHandle.style.alignItems = 'center';
            resizeHandle.innerHTML = '&#x2197;'; // Unicode for top-right arrow
            resizeHandle.style.color = 'white';
            resizeHandle.style.fontSize = '16px';
            spectrumContainer.appendChild(resizeHandle);

            let isResizing = false;
            let startX, startY, startWidth, startHeight;

            resizeHandle.addEventListener('mousedown', initResize, false);
            document.addEventListener('mousemove', resize, false);
            document.addEventListener('mouseup', stopResize, false);

            function initResize(e) {
                isResizing = true;
                startX = e.clientX;
                startY = e.clientY;
                startWidth = parseInt(document.defaultView.getComputedStyle(spectrumContainer).width, 10);
                startHeight = parseInt(document.defaultView.getComputedStyle(spectrumContainer).height, 10);
                e.preventDefault();
            }

            function resize(e) {
                if (!isResizing) return;
                const width = Math.max(300, startWidth + (e.clientX - startX));
                const height = Math.max(200, startHeight + (e.clientY - startY));
                spectrumContainer.style.width = width + 'px';
                spectrumContainer.style.height = height + 'px';
                spectraDiv.style.width = (width + 20) + 'px';
                currentChart.resize();
            }

            function stopResize() {
                isResizing = false;
            }
        }

        resetZoomButton.addEventListener('click', () => {
            if (currentChart) {
                currentChart.resetZoom();
            }
        });

        resetSizeButton.addEventListener('click', () => {
            spectrumContainer.style.width = '100%';
            spectrumContainer.style.height = '300px';
            spectraDiv.style.width = '400px';
            if (currentChart) {
                currentChart.resize();
            }
        });

        filterSelect.addEventListener('change', (event) => {
            if (currentChart) {
                const selectedReference = event.target.value;
                const currentType = typeSelect.value;
                const filteredData = selectedReference === 'all' 
                    ? spectraData[currentType] 
                    : spectraData[currentType].filter(d => d.REFERENCE === selectedReference);
                
                currentChart.data.datasets[0].data = filteredData.map(d => ({
                    x: d.CENTRALWAVELNG, 
                    y: d[currentType === 'transmission' ? 'PL_TRANDEP' : currentType === 'eclipse' ? 'ESPECLIPDEP' : 'FLAM'],
                    reference: d.REFERENCE
                }));
                currentChart.update();
            }
        });

        typeSelect.addEventListener('change', (event) => {
            createChart(event.target.value);
        });

        createChart(availableTypes[0]);
        
        document.body.appendChild(spectraDiv);
        currentSpectraDisplay = spectraDiv;
        messageEl1.style.display = 'none';
    } catch (error) {
        console.error('Error in displayPlanetSpectra:', error);
        showMessage('Error displaying spectral data. Please try again later.');
    }
}

function showMessage(message) {
    // Create or update a message element to display information to the user
    let messageEl = document.getElementById('message-display');
    if (!messageEl) {
        messageEl = document.createElement('div');
        messageEl.id = 'message-display';
        messageEl.style.position = 'absolute';
        messageEl.style.top = '10px';
        messageEl.style.left = '90%';
        messageEl.style.transform = 'translateX(-50%)';
        messageEl.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        messageEl.style.color = 'white';
        messageEl.style.padding = '10px';
        messageEl.style.borderRadius = '5px';
        messageEl.style.zIndex = '10000';
        document.body.appendChild(messageEl);
    }
    messageEl.textContent = message;
    messageEl.style.display = 'block';

    // Set a timeout to remove the message after 7 seconds
    setTimeout(() => {
        messageEl.style.display = 'none';
    }, 7000);
}

function showDataRefreshMessage(message) {
    // Create or update a message element to display information to the user
    messageEl1 = document.getElementById('message-display');
    if (!messageEl1) {
        messageEl1 = document.createElement('div');
        messageEl1.id = 'message-display';
        messageEl1.style.position = 'absolute';
        messageEl1.style.top = '10px';
        messageEl1.style.left = '90%';
        messageEl1.style.transform = 'translateX(-50%)';
        messageEl1.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        messageEl1.style.color = 'white';
        messageEl1.style.padding = '10px';
        messageEl1.style.borderRadius = '5px';
        messageEl1.style.zIndex = '10000';
        document.body.appendChild(messageEl1);
    }
    messageEl1.textContent = message;
    messageEl1.style.display = 'block';
}

function processStarSystems(data) {
    let starSystems = {};
    data.forEach(star => {
        starSystems[star.hostname] = {
            ...star,
            index: Object.keys(starSystems).length + 1
        };
    });
    return starSystems;
}

function createStarGroup(starSystems) {
    let starGroup = new THREE.Group();
    starGroup.name = 'starGroup';

    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const colors = [];
    const sizes = [];

    Object.values(starSystems).forEach((system, index) => {
        const coords = convertCoordinates(system.ra, system.dec, system.sy_dist);
        positions.push(coords.x, coords.y, coords.z);

        const color = getStarColor(system.st_teff || 5000);
        colors.push(color.r, color.g, color.b);

        const size = system.st_rad ? Math.log(system.st_rad + 1) * 0.7 : 0.7; // Increased base size
        sizes.push(size);

        system.index = index + 1;
    });

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
        uniforms: {
            pointTexture: { value: createStarTexture() },
            cameraNear: { value: camera.near },
            cameraFar: { value: camera.far },
        },
        vertexShader: `
            attribute float size;
            varying vec3 vColor;
            varying float vDistance;
            uniform float cameraNear;
            uniform float cameraFar;
            void main() {
                vColor = color;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                
                vDistance = (-mvPosition.z - cameraNear) / (cameraFar - cameraNear);
                
                float scale = 1.0 + vDistance * 150.0; // Increased scale factor
                gl_PointSize = size * scale * (300.0 / -mvPosition.z);
            }
        `,
        fragmentShader: `
            uniform sampler2D pointTexture;
            varying vec3 vColor;
            varying float vDistance;
            void main() {
                vec4 texColor = texture2D(pointTexture, gl_PointCoord);
                
                // Adjust brightness based on distance
                float brightness = 1.0 + vDistance * 10.0; // Increased brightness factor
                brightness = clamp(brightness, 1.0, 20.0); // Increased maximum brightness
                
                gl_FragColor = vec4(vColor * brightness, 1.0) * texColor;
            }
        `,
        depthTest: true,
        depthWrite: false,
        transparent: true,
        vertexColors: true
    });

    const points = new THREE.Points(geometry, material);
    points.userData.systems = Object.values(starSystems);
    starGroup.add(points);

    // Add Sun at the origin
    const solGeometry = new THREE.SphereGeometry(0.1, 16, 16);
    const solMaterial = new THREE.MeshBasicMaterial({ color: 0xff00ff });
    const solMesh = new THREE.Mesh(solGeometry, solMaterial);
    solMesh.position.set(0, 0, 0);
    solMesh.userData = { 
        index: 0,
        system: {
            hostname: 'Sun',
            sy_dist: 0,
            planets: []
        }
    };
    starGroup.add(solMesh);

    return starGroup;
}

function createBackgroundStars(count) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count * 3; i += 3) {
        // Random position within a sphere
        const radius = GALAXY_SIZE * (0.5 + Math.random() * 0.5);
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        
        positions[i] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i + 1] = radius * Math.sin(phi) * Math.sin(theta);
        positions[i + 2] = radius * Math.cos(phi);

        // White color with varying brightness
        const brightness = Math.random() * 0.5 + 0.5;
        colors[i] = colors[i + 1] = colors[i + 2] = brightness;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 0.1,
        vertexColors: true,
        sizeAttenuation: false
    });

    return new THREE.Points(geometry, material);
}

function createStarTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.3, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.5)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    
    return new THREE.CanvasTexture(canvas);
}

function getStarColor(temperature) {
    // Temperature is in Kelvin
    if (temperature >= 30000) {
        return new THREE.Color(0x9bb0ff); // Blue
    } else if (temperature >= 10000) {
        return new THREE.Color(0xaabfff); // Blue-white
    } else if (temperature >= 7500) {
        return new THREE.Color(0xcad7ff); // White
    } else if (temperature >= 6000) {
        return new THREE.Color(0xfbf8ff); // Yellow-white
    } else if (temperature >= 5200) {
        return new THREE.Color(0xfff4e8); // Yellow
    } else if (temperature >= 3700) {
        return new THREE.Color(0xffdab5); // Orange
    } else {
        return new THREE.Color(0xffb6b3); // Red
    }
}

function convertCoordinates(ra, dec, distance) {
    const raRad = ra * Math.PI / 180;
    const decRad = dec * Math.PI / 180;
    const x = distance * Math.cos(decRad) * Math.cos(raRad);
    const y = distance * Math.cos(decRad) * Math.sin(raRad);
    const z = distance * Math.sin(decRad);
    return { x, y, z };
}

function isDataStale() {
    const lastUpdate = localStorage.getItem('lastExoplanetDataUpdate');
    if (!lastUpdate) {
        console.log('No previous data found, will fetch new data');
        return true;
    }
    const oneWeek = 7 * 24 * 60 * 60 * 1000; // One week in milliseconds
    const isStale = Date.now() - parseInt(lastUpdate) > oneWeek;
    console.log(`Data is ${isStale ? 'stale' : 'fresh'}`);
    return isStale;
}


async function updateLocalData() {
    console.log('Updating local data');
    try {
        const data = await fetchExoplanetsData();
        console.log('Processing exoplanet data...');
        const processedData = data.map(planet => {
            const { x, y, z } = convertCoordinates(planet.ra, planet.dec, planet.sy_dist);
            return { ...planet, x, y, z };
        });
        console.log(`Processed ${processedData.length} exoplanets`);
        let procj = JSON.stringify(processedData)
        let compressedData = LZString.compress(procj);
        localStorage.setItem('exoplanetData', compressedData);
        localStorage.setItem('lastExoplanetDataUpdate', Date.now().toString());
        return processedData;
    } catch (error) {
        console.error('Error updating local data:', error);
        throw error;
    }
}

async function fetchExoplanetsData() {
    console.log('Fetching exoplanet data...');
    try {
        const response = await fetch('/api/exoplanets', {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
        });
        console.log('Fetch response received');
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Error response:', errorText);
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log(`Fetched ${data.length} exoplanets`);
        return data;
    } catch (error) {
        console.error('Error fetching exoplanet data:', error);
        throw error;
    }
}

function setupEventListeners(isStarSystem = false) {
    console.log('Setting up event listeners for', isStarSystem ? 'star system view' : 'galaxy view');
    
    // Remove all existing event listeners
    window.removeEventListener('resize', onWindowResize);
    window.removeEventListener('mousemove', onDocumentMouseMove);
    window.removeEventListener('mousedown', onDocumentMouseDown);
    window.removeEventListener('mouseup', onDocumentMouseUp);
    window.removeEventListener('contextmenu', onDocumentMouseRightClick);
    window.removeEventListener('wheel', onDocumentMouseWheel);

    if (renderer && renderer.domElement) {
        renderer.domElement.removeEventListener('mousedown', onRendererMouseDown);
        renderer.domElement.removeEventListener('mousemove', onRendererMouseMove);
        renderer.domElement.removeEventListener('mouseup', onRendererMouseUp);
    }

    // Add new event listeners
    window.addEventListener('resize', onWindowResize, false);

    if (!isStarSystem) {
        // Galaxy view event listeners
        window.addEventListener('mousemove', onDocumentMouseMove, false);
        window.addEventListener('mousedown', onDocumentMouseDown, false);
        window.addEventListener('mouseup', onDocumentMouseUp, false);
        window.addEventListener('contextmenu', onDocumentMouseRightClick, false);
        window.addEventListener('wheel', onDocumentMouseWheel, true);

        if (renderer && renderer.domElement) {
            renderer.domElement.addEventListener('mousedown', onRendererMouseDown, false);
            renderer.domElement.addEventListener('mousemove', onRendererMouseMove, false);
            renderer.domElement.addEventListener('mouseup', onRendererMouseUp, false);
        }
    } else {
        // Star system view event listeners
        if (starSystemRenderer && starSystemRenderer.domElement) {
            starSystemRenderer.domElement.addEventListener('mousedown', (event) => {
                mouseDownTime = Date.now();
            });
            starSystemRenderer.domElement.addEventListener('mouseup', handleStarSystemClick);
        }
    }

    console.log('Event listeners set up for', isStarSystem ? 'star system view' : 'galaxy view');
}

const searchButton = document.getElementById('search-button');
const searchInput = document.getElementById('srchkey');

searchInput.addEventListener('keypress', function(event) {
    console.log('Key pressed:', event.key);
    if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        searchfunc();
    }
});

searchButton.addEventListener('click', function(event) {
    event.preventDefault();
    event.stopPropagation();
    searchfunc();
});
    

function onRendererMouseDown(event) {
    console.log('Mouse down on renderer');
    if (controls) {
        controls.enabled = true;
    }
}

function onRendererMouseMove(event) {
    console.log('Mouse move on renderer');
    // TrackballControls handle this automatically
}

function onRendererMouseUp(event) {
    console.log('Mouse up on renderer');
    if (controls) {
        controls.enabled = true;
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);

    if (isInStarSystemView) {
        if (starSystemCamera) {
            starSystemCamera.aspect = window.innerWidth / window.innerHeight;
            starSystemCamera.updateProjectionMatrix();
        }
        if (starSystemRenderer) {
            starSystemRenderer.setSize(window.innerWidth, window.innerHeight);
        }
        if (labelRenderer) {
            labelRenderer.setSize(window.innerWidth, window.innerHeight);
        }
        if (starSystemControls) {  // Add this check
            starSystemControls.update();
        }
    }
}

function onDocumentMouseMove(event) {
    if (isOverSearchContainer) {
        if (selectedObject) {
            resetStarAppearance(selectedObject);
            selectedObject = null;
        }
        return;
    }
    
    if (isInStarSystemView) return; // Don't highlight stars in star system view

    const intersects = getIntersects(event.clientX, event.clientY);
    
    if (selectedObject) {
        resetStarAppearance(selectedObject);
        selectedObject = null;
    }

    if (intersects.length > 0) {
        const intersectedObject = intersects[0].object;
        if (intersectedObject instanceof THREE.Points) {
            const index = intersects[0].index;
            const system = intersectedObject.userData.systems[index];
            if (system) {
                selectedObject = intersectedObject;
                highlightStar(selectedObject, index);
                console.log('Hovering over star:', system.hostname);
            }
        }
    }
}

let isTransitioning = false;

function onDocumentMouseDown(event) {
    if (isOverSearchContainer) return;
    
    if (isTransitioning || isInStarSystemView) return;

    const intersects = getIntersects(event.clientX, event.clientY);
    if (intersects.length > 0) {
        const intersectedObject = intersects[0].object;
        if (intersectedObject instanceof THREE.Points) {
            const index = intersects[0].index;
            mouseDownObject = intersectedObject.userData.systems[index];
            mouseDownTime = Date.now();
        }
    }
}

function onDocumentMouseUp(event) {
    if (isOverSearchContainer) return;
    
    if (isTransitioning || isInStarSystemView) return;

    const intersects = getIntersects(event.clientX, event.clientY);
    if (intersects.length > 0) {
        const intersectedObject = intersects[0].object;
        if (intersectedObject instanceof THREE.Points) {
            const index = intersects[0].index;
            const system = intersectedObject.userData.systems[index];
            if (system === mouseDownObject && (Date.now() - mouseDownTime) < clickThreshold) {
                onStarClick(system);
            }
        }
    }

    mouseDownObject = null;
}

function onStarClick(system) {
    console.log(`Clicked on star: ${system.hostname}`);
    window.exoplanetState.selectedStarIndex = system.index;
    window.exoplanetState.selectedStar = system.hostname;
    const starPosition = new THREE.Vector3(system.x, system.y, system.z);
    console.log('Calling zoomToStar with position:', starPosition);
    isTransitioning = true;
    zoomToStar(starPosition, () => {
        switchToStarSystemView(system);
    });
}


function onDocumentMouseRightClick(event) {
    event.preventDefault();
    
    const intersects = getIntersects(event.clientX, event.clientY);
    if (intersects.length > 0) {
        const intersectedObject = intersects[0].object;
        if (intersectedObject instanceof THREE.Points) {
            const index = intersects[0].index;
            const system = intersectedObject.userData.systems[index];
            if (system) {
                if (system.index === 0) {
                    setStarColor(intersectedObject, index, 0xff00ff); // Magenta for Sun
                } else {
                    setStarColor(intersectedObject, index, 0x00ff00); // Green for other stars
                }
                window.exoplanetState.rightClickedStarIndex = system.index;
            }
        }
    }
}

function onDocumentMouseWheel(event) {
    // Update camera position in global state
    window.exoplanetState.cameraPosition = camera.position.clone();
    updateCenterGUI();
}

function getIntersects(x, y) {
    const mouse = new THREE.Vector2();
    mouse.x = (x / window.innerWidth) * 2 - 1;
    mouse.y = -(y / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    raycaster.params.Points.threshold = 0.2; // Increase this value to make stars easier to click

    const starGroup = scene.getObjectByName('starGroup');
    return raycaster.intersectObjects(starGroup.children);
}


function highlightStar(starObject, index) {
    const colors = starObject.geometry.attributes.color;
    const originalColor = new THREE.Color(
        colors.array[index * 3],
        colors.array[index * 3 + 1],
        colors.array[index * 3 + 2]
    );
    starObject.userData.originalColor = originalColor;
    setStarColor(starObject, index, 0x6699ff); // Highlight color
    starObject.userData.highlightedIndex = index;
}

function resetStarAppearance(starObject) {
    if (starObject.userData.originalColor && starObject.userData.highlightedIndex !== undefined) {
        const index = starObject.userData.highlightedIndex;
        setStarColor(starObject, index, starObject.userData.originalColor);
        delete starObject.userData.originalColor;
        delete starObject.userData.highlightedIndex;
    }
}

function setStarColor(starObject, index, color) {
    const colors = starObject.geometry.attributes.color;
    const newColor = new THREE.Color(color);
    colors.setXYZ(index, newColor.r, newColor.g, newColor.b);
    colors.needsUpdate = true;
}


function zoomToStar(starPosition, callback) {
    console.log('Starting zoom to star:', starPosition);
    controls.enabled = false; // Disable controls during movement

    const startPosition = camera.position.clone();
    const endPosition = starPosition.clone().add(new THREE.Vector3(0, 0, 5)); // Adjusted zoom distance

    const tween = new Tween(startPosition)
        .to(endPosition, 2000) // Increased duration for smoother transition
        .easing(Easing.Quadratic.InOut)
        .onUpdate(() => {
            camera.position.copy(startPosition);
            camera.lookAt(starPosition);
            controls.target.copy(starPosition);
        })
        .onComplete(() => {
            console.log('Zoom animation completed');
            camera.position.copy(endPosition);
            camera.lookAt(starPosition);
            controls.target.copy(starPosition);
            if (callback) {
                console.log('About to call zoom completion callback');
                callback();
            } else {
                console.log('No callback provided to zoomToStar');
            }
        });

    tweenGroup.add(tween);
    tween.start();
}


function updateExoplanetPage(index) {
    console.log(`Updating exoplanet page for index: ${index}`);
    let system = index === 0 ? {hostname: 'Sun', sy_dist: 0} : exoplanets[index];
    let name = index === 0 ? 'Star Name: Sun' : names[index];

    window.exoplanetState.selectedStar = name;
    window.exoplanetState.selectedStarIndex = index;

    // Update UI elements
    if (exoplanetName) exoplanetName.innerText = "Star Name: " + name;
    if (exoplanetName2) exoplanetName2.innerText = "Star Name: " + name;
    if (exoplanetDist) {
        exoplanetDist.innerText = index === 0 ? "Currently Centered 0 Pc (0 Ly) from the Sun" : `Currently Centered ${system.sy_dist.toFixed(2)} Pc (${(system.sy_dist * 3.26156).toFixed(2)} Ly) from the Sun`;
    }

    console.log(`System: ${JSON.stringify(system)}`);
    console.log(`Name: ${name}`);

    if (index === 0) {
        // Special case for Sun
        handleSunCase();
    } else {
        handleExoplanetCase(system, name);
    }

    let centeredSystem = exoplanets[window.exoplanetState.selectedStarIndex];

    // Handle the special case for the Sun
    if (exoplanetDist) {
        if (window.exoplanetState.selectedStarIndex === 0) {
            exoplanetDist.innerText = "Currently Centered 0 Pc (0 Ly) from the Sun";
        } else if (typeof centeredSystem.sy_dist === 'number') {
            exoplanetDist.innerText = `Distance from the Sun: ${centeredSystem.sy_dist.toFixed(2)} Pc (${(centeredSystem.sy_dist * 3.26156).toFixed(2)} Ly)`;
        } else {
            exoplanetDist.innerText = 'Distance unknown';
            console.warn('sy_dist is not a number for the centered system:', centeredSystem);
        }
    }

    if (exoplanetName) exoplanetName.innerText = window.exoplanetState.selectedStar + "\u00a0" ;
    if (exoplanetName2) exoplanetName2.innerText = "Star Name: " + window.exoplanetState.selectedStar;

    if (window.exoplanetState.selectedStarIndex !== 0 && Array.isArray(centeredSystem.planets) && exoplanetNames) {
        updatePlanetList(centeredSystem.planets);
    } else if (exoplanetNames) {
        exoplanetNames.innerText = "No planets data available";
    }

    // Only update center distance if not in star system view
    if (!isInStarSystemView && centerdist && centerdistly) {
        let cameraloc = camera.position;
        let centeredPosition = controls.target;
        let centerdistval = cameraloc.distanceTo(centeredPosition);
        // Only log if the distance has changed significantly
        if (lastLoggedDistance === null || Math.abs(centerdistval - lastLoggedDistance) > 0.1) {
            console.log(`Center distance: ${centerdistval.toFixed(2)}`);
            centerdist.innerHTML = centerdistval.toFixed(2);
            centerdistly.innerHTML = (3.262 * centerdistval).toFixed(2);
            lastLoggedDistance = centerdistval;
        }
    }
}

function updatePlanetList(planets) {
    const maxInitialPlanets = 3;
    let planetNames = planets.map(p => p.pl_name);
    
    if (planetNames.length <= maxInitialPlanets) {
        exoplanetNames.innerHTML = `Planets: ${planetNames.join(', ')}`;
    } else {
        let initialPlanets = planetNames.slice(0, maxInitialPlanets).join(', ');
        let remainingCount = planetNames.length - maxInitialPlanets;
        
        exoplanetNames.innerHTML = `Planets: ${initialPlanets} <a href="#" id="showMorePlanets">and ${remainingCount} more...</a>`;
        
        document.getElementById('showMorePlanets').onclick = function(e) {
            e.preventDefault();
            exoplanetNames.innerHTML = `Planets: ${planetNames.join(', ')} <a href="#" id="showLessPlanets">Show less</a>`;
            
            document.getElementById('showLessPlanets').onclick = function(e) {
                e.preventDefault();
                updatePlanetList(planets);
            };
        };
    }
}

function handleSunCase() {
    exoplanetColor.style.color = '#f0f';
    exoplanetColor.innerText = 'magenta';
    
    if (aladinDiv.style.display === 'none') aladinDiv.style.display = 'block';
    if (typeof A !== 'undefined') {
        A.aladin('#aladin-lite-div', { 
            target: 'Sun', 
            fov: 180, 
            showLayersControl: false, 
            showGotoControl: false,
            survey: "P/DSS2/color"
        });
    } else {
        // Fallback if Aladin is not available
        if (image.style.display === 'none') image.style.display = 'block';
        if (aladinDiv.style.display === 'block') aladinDiv.style.display = 'none';
        image.src = "https://upload.wikimedia.org/wikipedia/commons/c/c3/Solar_sys8.jpg"; // A image of the solar system
    }

    showExternalLinks('Sun');
    
    if (exoplanetNames) {
        exoplanetNames.innerText = "Planets: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune";
    }
}

function handleExoplanetCase(system, name) {
    if (exoplanetColor) {
        exoplanetColor.style.color = '#ff0';
        exoplanetColor.innerText = "\u00a0" + "yellow";
    }

    if (exoplanetNames) {
        if (Array.isArray(system.planets)) {
            exoplanetNames.innerText = `Planets: ${system.planets.map(p => p.pl_name).join(', ')}`;
        } else {
            exoplanetNames.innerText = 'No planets data available';
        }
    }

    showExternalLinks(name);
    updateAladin(system, name);
}

function showExternalLinks(name) {
    cdsLink.style.display = 'block';
    simbad.style.display = 'block';
    aladinLink.style.display = 'block';
    ned.style.display = 'block';

    if (name === 'Sun') {
        cdsLink.href = `http://cdsweb.u-strasbg.fr/cgi-bin/Class/simbad/`;
        simbad.href = `http://simbad.u-strasbg.fr/simbad/sim-id?Ident=Sun`;
        aladinLink.href = `https://aladin.u-strasbg.fr/AladinLite/?target=Sun&fov=180&survey=P/DSS2/color`;
        ned.href = `https://ned.ipac.caltech.edu/classic/`;
    } else {
        cdsLink.href = `http://cdsportal.u-strasbg.fr/?target=${(name)}`;
        simbad.href = `http://simbad.u-strasbg.fr/simbad/sim-id?Ident=${encodeURIComponent(name)}`;
        aladinLink.href = `https://aladin.u-strasbg.fr/AladinLite/?target=${encodeURIComponent(name)}`;
        ned.href = `https://ned.ipac.caltech.edu/cgi-bin/objsearch?extend=no&hconst=73&omegam=0.27&omegav=0.73&corr_z=1&out_csys=Equatorial&out_equinox=J2000.0&obj_sort=RA+or+Longitude&of=pre_text&zv_breaker=30000.0&list_limit=5&img_stamp=YES&objname=${encodeURIComponent(name)}`;
    }
}

function updateAladin(system, name) {
    let d = Math.sqrt(system.x*system.x + system.y*system.y + system.z*system.z);
    let fov = 1 / (d / 2);
    if (fov > 1) fov = 1;

    if (typeof A !== 'undefined') {
        if (aladinDiv.style.display === 'none') aladinDiv.style.display = 'block';
        if (image.style.display === 'block') image.style.display = 'none';
        A.aladin('#aladin-lite-div', { target: name, fov, showLayersControl: false, showGotoControl: false });
    } else {
        if (image.style.display === 'none') image.style.display = 'block';
        if (aladinDiv.style.display === 'block') aladinDiv.style.display = 'none';
        image.src = `http://alasky.u-strasbg.fr/cgi/simbad-thumbnails/get-thumbnail.py?name=${name}`;
    }
}

let lastLoggedDistance = null;

function updateCenterGUI() {

    let cameraloc = camera.position;
    let centeredPosition = controls.target;
    let centerdistval = cameraloc.distanceTo(centeredPosition);
    // Only log if the distance has changed significantly
    if (lastLoggedDistance === null || Math.abs(centerdistval - lastLoggedDistance) > 0.1) {
        console.log(`Center distance: ${centerdistval.toFixed(2)}`);
        centerdist.innerHTML = centerdistval.toFixed(2);
        centerdistly.innerHTML = (3.262 * centerdistval).toFixed(2);
        lastLoggedDistance = centerdistval;
    }
    
}

let frameCount = 0;

function render() {
    requestAnimationFrame(render);
    
    frameCount++;
    tweenGroup.update();

    const searchContainer = document.getElementById('search-container');
    if (searchContainer) {
        searchContainer.style.display = 'block';
        searchContainer.style.zIndex = '10000';
    }

    if (isInStarSystemView) {
        if (starSystemRenderer && starSystemScene && starSystemCamera && starSystemControls) {
            starSystemControls.update();
            
            if (frameCount % 60 === 0) {
                updateStarSystemScene();
            }
            
            if (starSystemRenderer && starSystemScene && starSystemCamera) {
                starSystemRenderer.render(starSystemScene, starSystemCamera);
                if (labelRenderer) {
                    labelRenderer.render(starSystemScene, starSystemCamera);
                }
            }
        }
    } else {
        if (controls && !isTransitioning) {
            controls.update();
        }

        if (scene && camera && renderer) {
            window.exoplanetState.cameraPosition = camera.position.clone();

            const starGroup = scene.getObjectByName('starGroup');
            if (starGroup && starGroup.children[0] instanceof THREE.Points) {
                const material = starGroup.children[0].material;
                material.uniforms.cameraNear.value = camera.near;
                material.uniforms.cameraFar.value = camera.far;
            }

            if (!isInStarSystemView && milkyWayMesh) {
                const distance = camera.position.length();
                
                if (distance > VISIBILITY_THRESHOLD) {
                    milkyWayMesh.visible = true;
                    
                    const opacityFactor = Math.min((distance - VISIBILITY_THRESHOLD) / (VISIBILITY_THRESHOLD * 5), 0.3);
                    milkyWayMesh.material.uniforms.opacity.value = opacityFactor;
                    
                    milkyWayMesh.material.uniforms.fadeEdge.value = Math.max(0.1, 0.3 - (distance / GALAXY_SIZE) * 0.2);
                } else {
                    milkyWayMesh.visible = false;
                }
            }

            composer.render();
        }
    }

    if (frameCount % 300 === 0) {
        console.log('Camera position:', camera ? camera.position : 'Camera not initialized');
        console.log('Controls target:', controls ? controls.target : 'Controls not initialized');
        const starGroup = scene ? scene.getObjectByName('starGroup') : null;
        if (starGroup && starGroup.children[0]) {
            console.log('Visible stars:', starGroup.children[0].geometry.attributes.position.count);
        }
    }
}

function setupStarSystemScene(star) {
    console.log('Setting up star system scene for:', star.hostname, 'Full star data:', star);
    return new Promise((resolve) => {
        try {
            starSystemScene = new THREE.Scene();
            starSystemCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
            starSystemRenderer = new THREE.WebGLRenderer({ antialias: true });
            starSystemRenderer.setSize(window.innerWidth, window.innerHeight);
            starSystemRenderer.setClearColor(0x000000, 1);

            // Add CSS2DRenderer
            labelRenderer = new CSS2DRenderer();
            labelRenderer.setSize(window.innerWidth, window.innerHeight);
            labelRenderer.domElement.style.position = 'absolute';
            labelRenderer.domElement.style.top = '0';
            labelRenderer.domElement.style.pointerEvents = 'none';
            document.body.appendChild(labelRenderer.domElement);

            // Initialize OrbitControls before adding event listeners
            starSystemControls = new OrbitControls(starSystemCamera, starSystemRenderer.domElement);
            starSystemControls.enableDamping = true;
            starSystemControls.dampingFactor = 0.25;
            starSystemControls.enableZoom = true;
            starSystemControls.minDistance = 5;
            starSystemControls.maxDistance = 1000;
            starSystemControls.enablePan = true;
            starSystemControls.panSpeed = 1.0;
            starSystemControls.rotateSpeed = 1.0;

            // Create star
            const starSize = Math.max(0.5, star.st_rad * 0.05);
            console.log(`Creating star with size: ${starSize}, Temperature: ${star.st_teff}, Luminosity: ${star.st_lum}`);
            const starGeometry = new THREE.SphereGeometry(starSize, 32, 32);
            const starMaterial = new THREE.MeshPhongMaterial({ 
                color: getStarColor(star.st_teff || 5000), 
                emissive: getStarColor(star.st_teff || 5000),
                emissiveIntensity: 0.5
            });
            const starMesh = new THREE.Mesh(starGeometry, starMaterial);
            starSystemScene.add(starMesh);
            console.log('Added star to scene');

            const habitableZone = createHabitableZone(star, starSize);
            if (habitableZone) {
                starSystemScene.add(habitableZone);
                console.log('Added habitable zone to scene');
            } else {
                console.warn('Unable to create habitable zone');
            }

            // Show habitable zone checkbox
            const habitableZoneContainer = document.getElementById('habitable-zone-container');
            habitableZoneContainer.style.display = 'block';

            // Handle checkbox state
            const habitableZoneCheckbox = document.getElementById('habitable-zone-checkbox');
            habitableZoneCheckbox.addEventListener('change', function() {
                if (habitableZone) {
                    habitableZone.visible = this.checked;
                }
            });

            // Create planets
            planets = [];
            if (Array.isArray(star.planets) && star.planets.length > 0) {
                console.log(`Creating ${star.planets.length} planets for ${star.hostname}`);
                star.planets.forEach((planet, index) => {
                    console.log(`Creating planet ${index + 1}:`, JSON.stringify(planet, null, 2));
                    const planetMesh = createPlanet(planet, index, starSize);
                    if (planetMesh) {
                        planetMesh.userData.planet = planet;
                        addClickListenerToMesh(planetMesh);
                    }
                });
            } else {
                console.log(`No planets data available for ${star.hostname}`);
            }

            // Position camera and update controls
            const systemRadius = Math.max(...planets.map(p => p.semiMajorAxis), 50);
            starSystemCamera.position.set(0, systemRadius / 2, systemRadius * 1.5);
            starSystemCamera.lookAt(0, 0, 0);
            starSystemControls.target.set(0, 0, 0);
            starSystemControls.update();

            // Add ambient light
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
            starSystemScene.add(ambientLight);

            // Add point light at the star's position
            const pointLight = new THREE.PointLight(0xffffff, 1);
            starSystemScene.add(pointLight);

            console.log('Star system scene setup completed');
            resolve();
        } catch (error) {
            console.error('Error setting up star system scene:', error);
            resolve();
        }
    });
}


function getBolometricCorrection(spectralClass) {
    const corrections = {
        'B': -2.0,
        'A': -0.3,
        'F': -0.15,
        'G': -0.4,
        'K': -0.8,
        'M': -2.0
    };
    return corrections[spectralClass] || -0.4; // Default to G if unknown
}

function createHabitableZone(star, starSize) {
    let logLuminosity = star.st_lum;
    let spectralType = star.st_spectype ? star.st_spectype.charAt(0).toUpperCase() : undefined;

    console.log(`Creating habitable zone. Star luminosity: ${logLuminosity}, Spectral type: ${spectralType}`);

    if (logLuminosity === null || logLuminosity === undefined) {
        console.warn(`Luminosity data missing for star ${star.hostname}. Attempting to calculate from other parameters.`);
        console.log(star.st_teff, star.st_rad, star.st_lum);
        
        // If luminosity is not provided, we'll attempt to calculate it
        if (star.st_teff && star.st_rad) {
            const stefanBoltzmannConstant = 5.670374419e-8; // W⋅m−2⋅K−4
            const solarRadius = 6.957e8; // meters
            const solarLuminosity = 3.828e26; // watts
            
            const starRadius = star.st_rad * solarRadius;
            const starTemp = star.st_teff;
            
            const calculatedLuminosity = 4 * Math.PI * Math.pow(starRadius, 2) * stefanBoltzmannConstant * Math.pow(starTemp, 4) / solarLuminosity;
            
            const bolometricCorrection = getBolometricCorrection(spectralType);
            logLuminosity = Math.log10(calculatedLuminosity) - bolometricCorrection / 2.5;
            
            console.log(`Calculated log luminosity: ${logLuminosity}`);
        } else {
            console.error(`Insufficient data to calculate luminosity for star ${star.hostname}. Cannot calculate habitable zone.`);
            return null;
        }
    }

    // Convert logarithmic luminosity to linear scale
    const luminosity = Math.pow(10, logLuminosity);

    // Calculate habitable zone boundaries
    const innerRadius = Math.sqrt(luminosity / 1.1); // in AU
    const outerRadius = Math.sqrt(luminosity / 0.53); // in AU

    console.log(`Star: ${star.hostname}, Spectral Type: ${spectralType}, Log Luminosity: ${logLuminosity}, Linear Luminosity: ${luminosity}`);
    console.log(`Habitable Zone: Inner radius = ${innerRadius.toFixed(2)} AU, Outer radius = ${outerRadius.toFixed(2)} AU`);

    // Convert AU to scene units
    const sceneInnerRadius = starSize + 10 + innerRadius * 15;
    const sceneOuterRadius = starSize + 10 + outerRadius * 15;

    const habitableZoneGeometry = new THREE.RingGeometry(sceneInnerRadius, sceneOuterRadius, 64);
    const habitableZoneMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.2
    });
    const habitableZoneMesh = new THREE.Mesh(habitableZoneGeometry, habitableZoneMaterial);
    habitableZoneMesh.rotation.x = Math.PI / 2;

    return habitableZoneMesh;
}

function logStarSystemDetails(starName) {
    const system = exoplanets.find(s => s.hostname === starName);
    if (system) {
        console.log(`Star System: ${starName}`);
        console.log('Star details:', {
            hostname: system.hostname,
            ra: system.ra,
            dec: system.dec,
            sy_dist: system.sy_dist,
            st_teff: system.st_teff,
            st_rad: system.st_rad,
            st_mass: system.st_mass,
            st_lum: system.st_lum,
            st_spectype: system.st_spectype,
        });
        console.log('Planets:');
        if (Array.isArray(system.planets)) {
            system.planets.forEach((planet, index) => {
                console.log(`Planet ${index + 1}:`, {
                    pl_name: planet.pl_name,
                    pl_orbsmax: planet.pl_orbsmax,
                    pl_rade: planet.pl_rade,
                    pl_bmasse: planet.pl_bmasse,
                    pl_orbeccen: planet.pl_orbeccen,
                });
            });
        } else {
            console.log('No planet data available');
        }
    } else {
        console.log(`Star system ${starName} not found`);
    }
}

// Call this function to log details for HD 7924
logStarSystemDetails('HD 7924');


function getPlanetColor(planet) {
    if (planet.pl_type === 'Gas Giant') return 0xFFA500;
    if (planet.pl_type === 'Neptune-like') return 0x4169E1;
    if (planet.pl_type === 'Super Earth') return 0x32CD32;
    if (planet.pl_type === 'Terrestrial') return 0x8B4513;
    return 0xC0C0C0;
}

function updateStarSystemScene() {
    if (!isInStarSystemView || !starSystemCamera || !planets) return;
    
    const cameraPosition = starSystemCamera.position;
    
    planets.forEach(planet => {
        if (!planet || !planet.mesh) return;
        
        const time = performance.now() * 0.0001;
        const angle = time * planet.orbitSpeed;
        
        const r = planet.semiMajorAxis * (1 - planet.eccentricity * planet.eccentricity) / 
                 (1 + planet.eccentricity * Math.cos(angle));
        const x = r * Math.cos(angle);
        const z = r * Math.sin(angle);
        
        planet.mesh.position.set(x, 0, z);
        
        if (planet.label && planet.label.element) {
            const distanceToCamera = cameraPosition.distanceTo(planet.mesh.position);
            const fadeStart = 100;
            const fadeEnd = 750;
            const opacity = Math.max(0, Math.min(1, 1 - (distanceToCamera - fadeStart) / (fadeEnd - fadeStart)));
            planet.label.element.style.opacity = opacity;
        }
    });

    if (starSystemControls) {
        starSystemControls.update();
    }
}


function switchToStarSystemView(star, targetPlanet = null) {
    console.log('Switching to star system view:', star.hostname);
    isInStarSystemView = true;
    if (milkyWayMesh) {
        milkyWayMesh.visible = false;
    }
    isTransitioning = true;

    // Fade out galaxy scene
    console.log('Starting fade out of galaxy scene');
    const fadeOutTween = new Tween({ opacity: 1 })
        .to({ opacity: 0 }, 1000)
        .easing(Easing.Quadratic.InOut)
        .onUpdate(({ opacity }) => {
            console.log('Fade out update, opacity:', opacity);
            if (renderer && renderer.domElement) {
                renderer.domElement.style.opacity = opacity;
            }
        })
        .onComplete(() => {
            console.log('Fade out complete, removing galaxy renderer');
            // Remove galaxy renderer
            if (renderer && renderer.domElement && renderer.domElement.parentNode) {
                renderer.domElement.parentNode.removeChild(renderer.domElement);
            }

            // Clear the galaxy scene
            while(scene.children.length > 0){ 
                scene.remove(scene.children[0]); 
            }

            // Reset camera and controls
            camera.position.set(0, 0, 200);
            controls.target.set(0, 0, 0);
            controls.update();

            console.log('Setting up star system scene');
            setupStarSystemScene(star).then(() => {
                if (starSystemRenderer && starSystemRenderer.domElement) {
                    document.body.appendChild(starSystemRenderer.domElement);
                    starSystemRenderer.domElement.style.opacity = 0;
                    
                    starSystemRenderer.domElement.style.position = 'absolute';
                    starSystemRenderer.domElement.style.top = '0';
                    starSystemRenderer.domElement.style.left = '0';
                    
                    setupEventListeners(true);

                    const uiElements = [
                        exoplanetName, 
                        exoplanetName2, 
                        exoplanetDist, 
                        exoplanetColor, 
                        exoplanetNames,
                        centerdist,
                        centerdistly,
                        exoColor,
                        centeredDis,
                        cdsLink,
                        simbad,
                        aladinLink,
                        ned,
                    ];
                    
                    const fadeInTween = new Tween({ opacity: 0 })
                        .to({ opacity: 1 }, 1000)
                        .easing(Easing.Quadratic.InOut)
                        .onUpdate(({ opacity }) => {
                            if (starSystemRenderer && starSystemRenderer.domElement) {
                                starSystemRenderer.domElement.style.opacity = opacity;
                            }
                        })
                        .onComplete(() => {
                            console.log('Fade in complete, updating UI');
                            isTransitioning = false;
                            updateExoplanetPage(window.exoplanetState.selectedStarIndex);
                            uiElements.forEach(element => {
                                if (element) {
                                    element.style.display = 'block';
                                    element.style.visibility = 'visible';
                                    element.style.opacity = '1';
                                    element.style.zIndex = '10000';
                                    element.style.pointerEvents = 'auto';
                                    element.style.position = 'relative';
                                    element.style.display = 'flex';
                                }
                            });
                            exoColor.style.display = 'none';
                            centeredDis.style.display = 'none';
                            if (targetPlanet) {
                                setTimeout(() => {
                                    simulateClickOnPlanet(targetPlanet.pl_name);
                                }, 1000);
                            }
                        });

                    tweenGroup.add(fadeInTween);
                    fadeInTween.start();
                } else {
                    console.error('starSystemRenderer or its domElement is undefined');
                    isTransitioning = false;
                }
            });
        });

    tweenGroup.add(fadeOutTween);
    fadeOutTween.start();
}


function switchToGalaxyView() {
    console.log('Switching back to galaxy view');
    isTransitioning = true;
    isInStarSystemView = false;
    addMilkyWayBackground();
    removeSpectraDisplay();

    // Hide habitable zone checkbox
    const habitableZoneContainer = document.getElementById('habitable-zone-container');
    habitableZoneContainer.style.display = 'none';

    // Cancel any ongoing render loops
    if (starSystemRenderer) {
        starSystemRenderer.setAnimationLoop(null);
    }

    // Dispose of controls
    if (starSystemControls) {
        starSystemControls.dispose();
        starSystemControls = null;
    }

    // Remove renderers
    if (starSystemRenderer && starSystemRenderer.domElement) {
        starSystemRenderer.domElement.remove();
        starSystemRenderer.dispose();
        starSystemRenderer = null;
    }

    if (labelRenderer && labelRenderer.domElement) {
        labelRenderer.domElement.remove();
        labelRenderer = null;
    }

    // Create a black overlay for the transition
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'black';
    overlay.style.opacity = '0';
    overlay.style.zIndex = '1000';
    document.body.appendChild(overlay);

    // Prepare the galaxy scene before starting the transition
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100000);
    
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor('#000000');
    
    let starData = processStarSystems(JSON.parse(LZString.decompress(localStorage.getItem('exoplanetData'))));
    let starGroup = createStarGroup(starData);
    scene.add(starGroup);
    
    let selectedStarPosition;
    if (window.exoplanetState.selectedStarIndex === 0) {
        selectedStarPosition = new THREE.Vector3(0, 0, 0);
    } else {
        const selectedStar = exoplanets[window.exoplanetState.selectedStarIndex];
        selectedStarPosition = new THREE.Vector3(selectedStar.x, selectedStar.y, selectedStar.z);
    }
    
    const distanceFromStar = 10;
    const newCameraPosition = selectedStarPosition.clone().add(new THREE.Vector3(0, 0, distanceFromStar));
    camera.position.copy(newCameraPosition);

    // Fade to black
    const fadeOutTween = new Tween({ opacity: 0 })
        .to({ opacity: 1 }, 1000)
        .easing(Easing.Quadratic.InOut)
        .onUpdate(({ opacity }) => {
            overlay.style.opacity = opacity;
        })
        .onComplete(() => {
            // Clear the star system scene
            if (starSystemScene) {
                while(starSystemScene.children.length > 0){ 
                    starSystemScene.remove(starSystemScene.children[0]); 
                }
            }

            // Reset star system variables
            starSystemScene = null;
            starSystemCamera = null;
            planets = [];

            // Add the galaxy renderer to the DOM
            document.body.appendChild(renderer.domElement);

            // Initialize TrackballControls
            controls = new TrackballControls(camera, renderer.domElement);
            controls.target.copy(selectedStarPosition);
            controls.minDistance = 0.1;
            controls.maxDistance = 80000;
            controls.zoomSpeed = 3;
            controls.rotateSpeed = 1.0;
            controls.panSpeed = 1.0;
            controls.dynamicDampingFactor = 0.3;
            controls.enabled = true;
            controls.update();

            composer = new EffectComposer(renderer);
            const renderPass = new RenderPass(scene, camera);
            composer.addPass(renderPass);
            const bloomPass = new UnrealBloomPass(
                new THREE.Vector2(window.innerWidth, window.innerHeight),
                1.5,
                0.4,
                0.85
            );
            composer.addPass(bloomPass);

            highlightCenteredStar(window.exoplanetState.selectedStarIndex);

            // Re-add event listeners
            setupEventListeners(false);

            // Fade from black
            const fadeInTween = new Tween({ opacity: 1 })
                .to({ opacity: 0 }, 1000)
                .easing(Easing.Quadratic.InOut)
                .onUpdate(({ opacity }) => {
                    overlay.style.opacity = opacity;
                })
                .onComplete(() => {
                    console.log('Fade in complete, updating UI');
                    isTransitioning = false;
                    updateExoplanetPage(window.exoplanetState.selectedStarIndex);
                    exoColor.style.display = 'flex';
                    centeredDis.style.display = 'flex';
                    exoColor.style.fontSize = '20px';
                    centeredDis.style.fontSize = '20px';
                    console.log('Camera position:', camera.position);
                    console.log('Controls target:', controls.target);
                    controls.enabled = true;
                    // Remove the overlay
                    document.body.removeChild(overlay);
                });

            tweenGroup.add(fadeInTween);
            fadeInTween.start();
        });

    tweenGroup.add(fadeOutTween);
    fadeOutTween.start();
}

function highlightCenteredStar(starIndex) {
    const starGroup = scene.getObjectByName('starGroup');
    if (starGroup && starGroup.children[0] instanceof THREE.Points) {
        const points = starGroup.children[0];
        const colors = points.geometry.attributes.color;
        const sizes = points.geometry.attributes.size;

        // Reset all stars to their original appearance
        for (let i = 0; i < colors.count; i++) {
            const originalColor = getStarColor(exoplanets[i].st_teff || 5000);
            colors.setXYZ(i, originalColor.r, originalColor.g, originalColor.b);
            sizes.setX(i, 0.2); // Reset to base size
        }

        // Highlight the centered star
        if (starIndex > 0 && starIndex < colors.count) {
            const highlightColor = new THREE.Color(0xffff00); // Bright yellow
            colors.setXYZ(starIndex - 1, highlightColor.r, highlightColor.g, highlightColor.b);
            sizes.setX(starIndex - 1, 0.6); // Make it 3 times larger
        }

        colors.needsUpdate = true;
        sizes.needsUpdate = true;
    }
}

function handleStarSystemClick(event) {
    if (Date.now() - mouseDownTime < clickThreshold) {
        console.log('Clicked in star system view');
    }
}


document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isInStarSystemView) {
        console.log('Escape key pressed, returning to galaxy view');
        removeSpectraDisplay();
        switchToGalaxyView();
    }
});



function searchfunc() {
    let srchkey = document.getElementById('srchkey').value.trim().toLowerCase();
    if (srchkey == '') return;
    console.log(`Searching for: ${srchkey}`);
    let found = false;
    let targetSystem = null;
    let targetPlanet = null;

    if (srchkey === 'sun' || srchkey === 'sol') {
        targetSystem = exoplanets[0];
        found = true;
    } else {
        for (let i = 1; i < exoplanets.length; i++) {
            let system = exoplanets[i];
            if (system.hostname.toLowerCase().includes(srchkey)) {
                targetSystem = system;
                found = true;
                break;
            }
            if (Array.isArray(system.planets)) {
                for (let planet of system.planets) {
                    if (planet.pl_name.toLowerCase().includes(srchkey)) {
                        targetSystem = system;
                        targetPlanet = planet;
                        found = true;
                        break;
                    }
                }
            }
            if (found) break;
        }
    }
    
    if (!found) {
        console.log(`Star system or planet not found: ${srchkey}`);
        alert(srchkey + ' not found.');
    } else {
        console.log(`Search completed. Found: ${targetSystem.hostname}`);
        window.exoplanetState.selectedStarIndex = targetSystem.index || 0;
        window.exoplanetState.selectedStar = targetSystem.hostname;
        
        const starPosition = new THREE.Vector3(targetSystem.x || 0, targetSystem.y || 0, targetSystem.z || 0);
        
        if (isInStarSystemView) {
            switchToGalaxyView(() => {
                zoomToStar(starPosition, () => {
                    switchToStarSystemView(targetSystem, targetPlanet);
                });
            });
        } else {
            zoomToStar(starPosition, () => {
                switchToStarSystemView(targetSystem, targetPlanet);
            });
        }
    }
}

function simulateClickOnPlanet(planetName) {
    // Wait for the star system view to fully load
    setTimeout(() => {
        const planets = window.planets; // Assuming planets are stored in a global variable
        if (!planets || planets.length === 0) {
            console.log(`Planets not loaded yet for ${planetName}`);
            return;
        }
        const targetPlanet = planets.find(p => p.data.pl_name.toLowerCase() === planetName.toLowerCase());
        
        if (targetPlanet) {
            console.log(`Simulating click on planet: ${planetName}`);
            // Create a fake event object
            const fakeEvent = {
                object: targetPlanet.mesh
            };
            // Call the onPlanetClick function with the fake event
            onPlanetClick(fakeEvent);
        } else {
            console.log(`Planet ${planetName} not found in the current star system view`);
        }
    }, 1000); // Adjust this delay if needed
}



if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeScene);
} else {
    initializeScene();
}

window.searchfunc = searchfunc;