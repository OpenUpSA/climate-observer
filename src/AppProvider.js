import { useState, useEffect, useRef } from 'react';
import { AppContext } from './AppContext';

import axios from 'axios';
import Papa from 'papaparse';

import supabase from './supabase';

import html2canvas from 'html2canvas';
import ADHLogo from './ADHLogo';

import * as cities from './data/cities.json';
import * as countries from './data/countries.json';

export const AppProvider = ({ children }) => {
    
    const [loading, setLoading] = useState(true);
    const [dateRange, setDateRange] = useState([1993, 2026]);
    const [position, setPosition] = useState([]);
    const [city, setCity] = useState('');
    const [country, setCountry] = useState('');
    const [address, setAddress] = useState('');
    const [extraLocation, setExtraLocation] = useState('');
    
    const [climatology, setClimatology] = useState([]);
    const [historicalPrecipitation, setHistoricalPrecipitation] = useState([]);
    const [temperatureData, setTemperatureData] = useState([]);
    const [precipitationData, setPrecipitationData] = useState([]);
    const [currentData, setCurrentData] = useState([]);
    const [allData, setAllData] = useState([]);

    const [annualAvgTemperature, setAnnualAvgTemperature] = useState(null);
    const [annualAvgPrecipitation, setAnnualAvgPrecipitation] = useState(null);
    const [annualAvgAQ, setAnnualAvgAQ] = useState(null);
    const [maxPrecipitation, setMaxPrecipitation] = useState(null);
    const [allAirQualityData, setAllAirQualityData] = useState([]);
    const [airQualityData, setAirQualityData] = useState([]);

    const [airQualityAverages, setAirQualityAverages] = useState({
        'aod_mean': 0,
        'aod_std': 0,
        'aod_min': 0,
        'aod_max': 0
    });

    const [airQuality, setAirQuality] = useState('');

    const temperatureScale = [
        { min: -Infinity, max: -1, color: '#08306b' },
        { min: -1, max: -0.5, color: '#6baed6' },
        { min: -0.5, max: 0, color: '#deebf7' },
        { min: 0, max: 0.5, color: '#fee0d2' },
        { min: 0.5, max: 1, color: '#fdcc8a' },
        { min: 1, max: 1.5, color: '#fc9272' },
        { min: 1.5, max: Infinity, color: '#67000d' }
    ]

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    
    const airQualityScale = [
        {
            quality: 'Good',
            short_label: 'Good',
            min: 0,
            max: 100,
            color: 'rgba(133,223,255,1)'
        },
        {
            quality: 'Moderate',
            short_label: 'Moderate',
            min: 101,
            max: 300,
            color: 'rgba(151,199,206,1)'
        },
        {
            quality: 'Unhealthy for sensitive groups',
            short_label: 'Sensitive',
            min: 301,
            max: 600,
            color: 'rgba(166,180,166,1)'
        },
        {
            quality: 'Unhealthy',
            short_label: 'Unhealthy',
            min: 601,
            max: 1000,
            color: 'rgba(173,171,148,1)'
        },
        {
            quality: 'Very Unhealthy',
            short_label: 'Very Unhealthy',
            min: 1001,
            max: 2000,
            color: 'rgba(167,155,132,1)'
        },
        {
            quality: 'Hazardous',
            short_label: 'Hazardous',
            min: 2001,
            max: 5000,
            color: 'rgba(158,130,107,1)'
        }
    ]

    ////////////////////////////////
    // useEffects
    ////////////////////////////////
    useEffect(() => {

        let searchTerms = document.location.search.split('&');

        let daterangesearch = searchTerms.filter(term => term.includes('daterange='))[0];

        if (document.location.search.includes('daterange=')) {

            let date_range = daterangesearch.split('=')[1];

            if (date_range.includes(',')) {
                let start = parseInt(date_range.split(',')[0]);
                let end = parseInt(date_range.split(',')[1]);
                setDateRange([start, end]);
            }
        }

        if (document.location.search.includes('position=')) {

            let positionsearch = searchTerms.filter(term => term.includes('position='))[0];

            let position = positionsearch.split('=')[1];

            if (position.includes(',')) {
                let lat = parseFloat(position.split(',')[0]);
                let lon = parseFloat(position.split(',')[1]);
                findAddress([lat, lon]);
                setPosition([lat, lon]);
            }


        } else if (document.location.search.includes('city=')) {


            let citysearch = searchTerms.filter(term => term.includes('city='))[0];

            let city = citysearch.split('=')[1];

            city = city.replace('?city=', '').replaceAll('-', ' ');

            if (city == 'abomey calavi') city = 'abomey-calavi';
            if (city == 'mbuji mayi') city = 'mbuji-mayi';
            if (city == 'pointe noire') city = 'pointe-noire';
            if (city == 'cape town') city = 'cape-town';
            if (city == 'addis ababa') city = 'addis-ababa';
            if (city == 'dar es salaam') city = 'dar-es-salaam';
            if (city == 'port harcourt') city = 'port-harcourt';
            if (city == 'bobo dioulasso') city = 'bobo-dioulasso';
            if (city == 'west rand') city = 'west-rand';
            if (city == 'benin city') city = 'benin-city';

            setCity(city);
        } else {
            let randomCity = cities[Math.floor(Math.random() * cities.length)];
            setCity(randomCity.city.replaceAll(' ', '-').toLowerCase());

        }

        
    }, []);

    useEffect(() => {

        if (temperatureData.length > 0 && precipitationData.length > 0 && climatology.length > 0 && historicalPrecipitation.length > 0) {
            let combinedData = [];

            temperatureData.forEach((record, index) => {
                let month_number = parseInt(record.month_number);
                let climatologyRecord = climatology.filter(d => d.month_number == month_number)[0];
                let precipRecord = historicalPrecipitation.filter(d => d.month_number == month_number)[0];
                
                let newRecord = {
                    ...record,
                    precip: precipitationData[index]?.precip || precipRecord.precip_hist,
                    precip_hist: precipRecord.precip_hist,
                    tavg_climatology: climatologyRecord.tavg_climatology,
                    tmax_climatology: climatologyRecord.tmax_climatology,
                    tmin_climatology: climatologyRecord.tmin_climatology
                }

                
                newRecord.tavg_temperature = parseFloat(newRecord.tavg_temperature).toFixed(2);
                newRecord.tmax_temperature = parseFloat(newRecord.tmax_temperature).toFixed(2);
                newRecord.tmin_temperature = parseFloat(newRecord.tmin_temperature).toFixed(2);
                newRecord.tavg_climatology = parseFloat(newRecord.tavg_climatology).toFixed(2);
                newRecord.tmax_climatology = parseFloat(newRecord.tmax_climatology).toFixed(2);
                newRecord.tmin_climatology = parseFloat(newRecord.tmin_climatology).toFixed(2);
                newRecord.precip = parseFloat(newRecord.precip).toFixed(2);
                newRecord.precip_hist = parseFloat(newRecord.precip_hist).toFixed(2);
                newRecord.tavg_anomaly = parseFloat(newRecord.tavg_anomaly).toFixed(2);
                newRecord.tmax_anomaly = parseFloat(newRecord.tmax_anomaly).toFixed(2);
                newRecord.tmin_anomaly = parseFloat(newRecord.tmin_anomaly).toFixed(2);

                combinedData.push(newRecord);
            });

            setAllData(combinedData);
        }


      

    },[climatology, historicalPrecipitation, temperatureData, precipitationData]);

    useEffect(() => {
        filterDataByDate();
    }, [allData]);

    useEffect(() => {
        setLoading(false);
    }, [currentData]);

    useEffect(() => {

        let min_year = dateRange[0];
        if(min_year < 2002) {
            min_year = 2002;
        }

        let airQualityDataFilter = allAirQualityData.filter(d => d.year >= dateRange[0] && d.year <= dateRange[1]);

        setAirQualityData(sortData(airQualityDataFilter));

    }, [allAirQualityData]);

    useEffect(() => {
        processAirQualityData();
    }, [airQualityData]);

    useEffect(() => {
    }, [airQuality, airQualityAverages]);

    useEffect(() => {
        if(allData.length > 0) {
            setAnnualAvgTemperature(getAnnualAvgTemperature());
            setAnnualAvgPrecipitation(getAnnualPrecipitation());
            setAnnualAvgAQ(getAnnualAQ());
        }
    }, [allData]);

    useEffect(() => {
        if (city != '' && city != 'location') {
            let city_data = cities.filter(c => c.city.replaceAll(' ', '-').toLowerCase() == city)[0];

            if (city_data == undefined) {
                setCity('');
                return;
            }

            setCountry(city_data.iso_code);
            setPosition([city_data.lat, city_data.lon]);


            window.history.pushState(
                {},
                '',
                `${window.location.pathname}?city=${city}`
            );
        }
    }, [city]);

    useEffect(() => {

        if (position.length > 0) {
            getAllData();
        }

    }, [position]);

    useEffect(() => {
        // window.history.pushState(
        //     {}, 
        //     '', 
        //     window.location.pathname.includes('?') ? window.location.pathname + '&daterange=' + dateRange.join(',') : window.location.pathname + '?daterange=' + dateRange.join(',')
        // );
        if (dateRange[0] > dateRange[1]) {
            setDateRange([dateRange[1], dateRange[0]]);
        }
        filterDataByDate();
    }, [dateRange]);



    // LOCATION

    const findAddress = async (middlePoint, extra) => {

        const { data, error } = await supabase
            .from('locations')
            .select()
            .gte('latitude', parseFloat(middlePoint[0]) - 0.5)
            .lte('latitude', parseFloat(middlePoint[0]) + 0.5)
            .gte('longitude', parseFloat(middlePoint[1]) - 0.5)
            .lte('longitude', parseFloat(middlePoint[1]) + 0.5)
            .limit(1);

        if (error) {
            console.log(error);
            return;
        }

        if (data.length > 0) {
            setAddress(
                data[0].city ? data[0].city :
                    data[0].town ? data[0].town :
                        data[0].village ? data[0].village :
                            data[0].hamlet ? data[0].hamlet :
                                data[0].county ? data[0].county :
                                    data[0].region ? data[0].region :
                                        data[0].state ? data[0].state :
                                            ''
            );
            setCity('location');
            if (extra != undefined) {
                setExtraLocation(extra);
            } else {
                setExtraLocation('');
            }
            setCountry(convertCountry('iso2', data[0].country_code).iso3);
        } else {
            setExtraLocation('');
            setAddress('');
            setCity('');
            setCountry('');
        }

        setPosition(middlePoint);

    }

    // DATA
    async function getAllData() {
        setLoading(true);
        console.log('[getAllData] position:', position);

        getClimatologyData();
        getHistoricalPrecipData();
        getTemperatureData();
        getPrecipData();
        getAQData();

    }

    // `payload` carries data that is built in a component rather than from the
    // shared datasets, e.g. the crop charts (which scale WRSI by the selected
    // crop's Kc mid) pass the rows they plot.
    async function downloadData(type, set, month = null, payload = null) {

        if (type == 'png') {



            let svgContainer = document.getElementById(set);
            let svg = svgContainer.getElementsByTagName('svg')[0];

            // Create a new SVG element
            const svgElement = new DOMParser().parseFromString(ADHLogo(), "image/svg+xml").querySelector("svg");

            // Set any attributes you need on the new SVG element
            svgElement.setAttribute("width", "244");
            svgElement.setAttribute("height", "53");
            svgElement.setAttribute("viewBox", "0 0 244 53");
            svgElement.setAttribute("fill", "none");

            // Create a new group element to hold the watermark
            const gElement = document.createElementNS("http://www.w3.org/2000/svg", "g");

            // Calculate center position for x and y
            const centerX = (svg.width.baseVal.value - 244) / 2;
            const centerY = (svg.height.baseVal.value - 53) / 2;

            // Set the transform for centering
            gElement.setAttribute("transform", `translate(${centerX}, ${centerY})`);

            // Append the SVG element to the group
            gElement.appendChild(svgElement);

            svgElement.setAttribute("fill-opacity", "0.3");

            svg.appendChild(gElement);

            html2canvas(svgContainer)
                .then(canvas => {
                    const ctx = canvas.getContext('2d');
                    const link = document.createElement('a');
                    link.download = set + '-' + position[0] + '-' + position[1] + '-' + dateRange[0] + '-' + dateRange[1] + '.png';
                    link.href = canvas.toDataURL();
                    link.click();

                    // Remove the watermark SVG
                    svg.removeChild(gElement);
                })
                .catch(error => {
                    console.error('Error:', error);
                });




        } else {

            let csvContent = "data:text/csv;charset=utf-8,";

            if (set == 'monthly-temperature') {
                csvContent += "Month,Year,Average Temperature,Historical Average,Max Temperature,Min Temperature,Historical Max,Historical Min\n";
                currentData.forEach(record => {
                    csvContent += monthNames[record.month_number - 1] + ',' + record.year + ',' + record.tavg_temperature + ',' + record.tavg_climatology + ',' + record.tmax_temperature + ',' + record.tmin_temperature + ',' + record.tmax_climatology + ',' + record.tmin_climatology + '\n';
                });
            } else if (set == 'monthly-temperature-anomaly') {
                csvContent += "Month,Year,Average Anomaly";
                currentData.forEach(record => {
                    csvContent += monthNames[record.month_number - 1] + ',' + record.year + ',' + record.tavg_anomaly + '\n';
                });
            } else if (set == 'monthly-temperature-breakdown') {
                csvContent += "Month,Year,Average Temperature,Historical Average,Max Temperature,Min Temperature,Historical Max,Historical Min\n";
                currentData.forEach(record => {
                    csvContent += monthNames[record.month_number - 1] + ',' + record.year + ',' + record.tavg_temperature + ',' + record.tavg_climatology + ',' + record.tmax_temperature + ',' + record.tmin_temperature + ',' + record.tmax_climatology + ',' + record.tmin_climatology + '\n';
                });
                month = monthNames[month];
            } else if (set == 'monthly-precipitation') {
                csvContent += "Month,Year,Precipitation";
                currentData.forEach(record => {
                    csvContent += monthNames[record.month_number - 1] + ',' + record.year + ',' + record.precip + '\n';
                });
                month = monthNames[month];
            } else if (set == 'monthly-precipitation-breakdown') {
                csvContent += "Month,Year,Precipitation";
                currentData.forEach(record => {
                    csvContent += monthNames[record.month_number - 1] + ',' + record.year + ',' + record.precip + '\n';
                });
                month = monthNames[month];
            } else if (set == 'annual-temperature') {
                csvContent += "Year,Month,Average Temperature,Historical Average\n";
                currentData.forEach(record => {
                    csvContent += record.time + ',' + monthNames[record.month_number - 1] + ',' + record.tavg_temperature + ',' + record.tavg_climatology + '\n';
                });
            } else if (set == 'annual-precipitation') {
                csvContent += "Year,Month,Precipitation,Historical Average\n";
                currentData.forEach(record => {
                    csvContent += record.year + ',' + monthNames[record.month_number - 1] + ',' + record.precip + ',' + record.precip_hist + '\n';
                });
            } else if (set == 'crop-annual' || set == 'crop-monthly-breakdown') {
                // Crop charts are built in CropYield from the `crops` table and scaled
                // by the selected crop's Kc mid, so the plotted rows come in via payload.
                const rows = payload?.rows || [];
                const cropLabel = payload?.crop ? ` (${payload.crop})` : '';
                const row = r => r.year + ',' + r.value + ',' + (r.trend ?? '') + '\n';

                if (set == 'crop-monthly-breakdown') {
                    csvContent += `Month,Year,WRSI${cropLabel},Trend\n`;
                    rows.forEach(r => { csvContent += monthNames[month - 1] + ',' + row(r); });
                    month = monthNames[month - 1] ?? null; // takes a 1-based month number
                } else {
                    csvContent += `Year,WRSI${cropLabel},Trend\n`;
                    rows.forEach(r => { csvContent += row(r); });
                }
            }

            // save the csvContent to a file and download
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);

            // Crop chart downloads for different crops would otherwise share a filename
            const cropSuffix = payload?.crop
                ? '-' + payload.crop.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
                : '';

            if (city != 'location') {
                link.setAttribute("download", `${set}${month != null ? '-' + month : ''}${cropSuffix}.${city}.${dateRange[0]}-${dateRange[1]}.csv`);
            } else {
                link.setAttribute("download", `${set}${month != null ? '-' + month : ''}${cropSuffix}.${position[0]},${position[1]}.${dateRange[0]}-${dateRange[1]}.csv`);
            }
            document.body.appendChild(link);
            link.click();
        }


    }

    // TEMP

    async function getClimatologyData() {

        const lat = parseFloat(position[0]);
        const lon = parseFloat(position[1]);
        console.log('[getClimatologyData] querying lat/lon:', lat, lon);

        const { data, error } = await supabase
            .from('climatology')
            .select()
            .gt('latitude', lat - 0.5)
            .lt('latitude', lat + 0.5)
            .gt('longitude', lon - 0.5)
            .lt('longitude', lon + 0.5)

        if (error) {
            console.log('error', error)
        } else {
            console.log('[getClimatologyData] rows returned:', data.length);
            setClimatology(data);
        }
        


    }

    async function getTemperatureData() {

        

        const { data, error } = await supabase
            .from('temperature')
            .select()
            .gt('latitude', parseFloat(position[0]) - 0.5)
            .lt('latitude', parseFloat(position[0]) + 0.5)
            .gt('longitude', parseFloat(position[1]) - 0.5)
            .lt('longitude', parseFloat(position[1]) + 0.5)

            if (error) {
                console.log('error', error)
            } else {

                data.forEach(d => {
                    d.minmax_temperature = [d.tmax_temperature, d.tmin_temperature]
                });

                setTemperatureData(sortData(data));
            }

    }

    const getAnnualAvgTemperature = () => {

        let annualAvg = 0;

        allData.forEach(record => {
            if (parseInt(record.year) == 2025) {
                annualAvg += parseFloat(record.tavg_temperature);
            }
        });

        annualAvg = annualAvg / 12;

        return annualAvg;


    }

    // PRECIP

    async function getHistoricalPrecipData() {
        
        const { data, error } = await supabase
            .from('precipitation_historical')
            .select()
            .gt('latitude', parseFloat(position[0]) - 0.5)
            .lt('latitude', parseFloat(position[0]) + 0.5)
            .gt('longitude', parseFloat(position[1]) - 0.5)
            .lt('longitude', parseFloat(position[1]) + 0.5)

            if (error) {
                
                console.log('error', error)

            } else {
                
                setHistoricalPrecipitation(data);
            
            }

    }

    async function getPrecipData() {

        
        let latmin = parseFloat(position[0]) - 0.5;
        let latmax = parseFloat(position[0]) + 0.5;
        let lonmin = parseFloat(position[1]) - 0.5;
        let lonmax = parseFloat(position[1]) + 0.5;

        const { data, error } = await supabase
            .from('precipitation')
            .select()
            .gt('latitude', latmin)
            .lt('latitude', latmax)
            .gt('longitude', lonmin)
            .lt('longitude', lonmax)

            if (error) {
                
                console.log('error', error)

            } else {
                setPrecipitationData(sortData(data));            
            }

    }

    const getAnnualPrecipitation = () => {

        let annualAvg = 0;

        allData.forEach(record => {
            
            let currentYear = new Date().getFullYear();
            let lastCompleteYear = currentYear - 1;
            
            if (parseInt(record.year) == lastCompleteYear) {
                annualAvg += parseFloat(record.precip);
            }
        });

        return annualAvg;

    }

    // AIR QUALITY

    async function getAQData() {

        const { data, error } = await supabase
            .from('air_quality')
            .select()
            .gt('latitude', parseFloat(position[0]) - 0.5)
            .lt('latitude', parseFloat(position[0]) + 0.5)
            .gt('longitude', parseFloat(position[1]) - 0.5)
            .lt('longitude', parseFloat(position[1]) + 0.5)

            if (error) {
                console.log('error', error)

            } else {
                setAllAirQualityData(data);
            }

    }

    const processAirQualityData = () => {
        
        let averages = {
            'aod_mean': 0,
            'aod_std': 0,
            'aod_min': 0,
            'aod_max': 0
        };

        let count = 0;

        airQualityData.forEach((d) => {
            averages['aod_mean'] += d.aod_mean;
            averages['aod_std'] += d.aod_std;
            averages['aod_min'] += d.aod_min;
            averages['aod_max'] += d.aod_max;
            count++;
        })

        averages['aod_mean'] = averages['aod_mean'] / count;
        averages['aod_std'] = averages['aod_std'] / count;
        averages['aod_min'] = averages['aod_min'] / count;
        averages['aod_max'] = averages['aod_max'] / count;

        setAirQualityAverages(averages);

        let quality = '';

        let airQualityValue = averages['aod_mean'];

        
        // Set air quality based on value
        for (let i = 0; i < airQualityScale.length; i++) {
            if (airQualityValue >= airQualityScale[i].min && airQualityValue <= airQualityScale[i].max) {
                quality = airQualityScale[i].quality;
                break;
            }
        }
        
        
        setAirQuality(quality);
    
    }

    const getAnnualAQ = () => {

        let annualAvg = 0;

        allAirQualityData.forEach(record => {
            
            let currentYear = new Date().getFullYear();
            let lastCompleteYear = currentYear - 1;
            
            if (parseInt(record.year) == lastCompleteYear) {
                annualAvg += parseFloat(record.aod_mean);
            }
        });

        return annualAvg / 12;
    
    }

   
    ////////////////////////////////
    // HELPERS
    ////////////////////////////////

    const filterDataByDate = () => {

        let filteredData = allData.filter(record => {
            return parseInt(record.year) >= dateRange[0] && parseInt(record.year) <= dateRange[1];
        });

        setCurrentData(filteredData);    

    }

    const getAnomalyColor = (anomaly) => {

        if (anomaly < -1) return '#08306b';
        if (anomaly < -0.5) return '#6baed6';
        if (anomaly < 0) return '#deebf7';
        if (anomaly < 0.5) return '#fee0d2';
        if (anomaly < 1) return '#fdcc8a';
        if (anomaly < 1.5) return '#fc9272';

        return '#67000d';

    }

    const sortData = (data) => {
        data.sort((a, b) => {
            const aYear = parseInt(a.year);
            const bYear = parseInt(b.year);

            const aMonth = parseInt(a.month_number);
            const bMonth = parseInt(b.month_number);

            if (aYear < bYear) return -1;
            if (aYear > bYear) return 1;

            if (aMonth < bMonth) return -1;
            if (aMonth > bMonth) return 1;

            return 0;

        });

        return data;
    }

    const convertCountry = (type, value) => {

        if (value == '' || value == undefined) return '';

        let country = countries.filter(c => c[type].toUpperCase() == value.toUpperCase())[0];

        if (country == undefined) {
            return '';
        } else {
            return country;
        }

    }

    const changeDateRange = (type, value) => {

        if (type == 'start') {
            setDateRange([parseInt(value), dateRange[1]]);
        } else {
            setDateRange([dateRange[0], parseInt(value)]);
        }
    }

    ////////////////////////////////
    // MISC
    ////////////////////////////////

    const addMetaTags = () => {
        // Set title
        document.title = 'Climate Observer | Africa Data Hub';

        // Remove existing meta tags
        let existingTitle = document.querySelector('meta[property="og:title"]');
        if (existingTitle) { existingTitle.remove(); }

        let existingDescriptionOG = document.querySelector('meta[property="og:description"]');
        if (existingDescriptionOG) { existingDescriptionOG.remove(); }

        let existingUrlOG = document.querySelector('meta[property="og:url"]');
        if (existingUrlOG) { existingUrlOG.remove(); }

        let existingTwitterTitle = document.querySelector('meta[name="twitter:title"]');
        if (existingTwitterTitle) { existingTwitterTitle.remove(); }

        let existingDescriptionTwitter = document.querySelector('meta[name="twitter:description"]');
        if (existingDescriptionTwitter) { existingDescriptionTwitter.remove(); }

        let existingUrlTwitter = document.querySelector('meta[name="twitter:url"]');
        if (existingUrlTwitter) { existingUrlTwitter.remove(); }

        let existingDescriptionNormal = document.querySelector('meta[name="description"]');
        if (existingDescriptionNormal) { existingDescriptionNormal.remove(); }

        // Create new meta tags
        let newMetaTitle = document.createElement('meta');
        newMetaTitle.setAttribute('property', 'og:title');
        newMetaTitle.setAttribute('content', 'Climate Observer | Africa Data Hub');

        let newMetaDescriptionOG = document.createElement('meta');
        newMetaDescriptionOG.setAttribute('property', 'og:description');
        newMetaDescriptionOG.setAttribute('content', 'Explore climate data for cities in Africa');

        let newMetaUrlOG = document.createElement('meta');
        newMetaUrlOG.setAttribute('property', 'og:url');
        newMetaUrlOG.setAttribute('content', window.location.href);

        let newMetaTitleTwitter = document.createElement('meta');
        newMetaTitleTwitter.setAttribute('name', 'twitter:title');
        newMetaTitleTwitter.setAttribute('content', 'Co2 - Climate Observer | Africa Data Hub');

        let newMetaDescriptionTwitter = document.createElement('meta');
        newMetaDescriptionTwitter.setAttribute('name', 'twitter:description');
        newMetaDescriptionTwitter.setAttribute('content', 'Explore climate data for cities in Africa');

        let newMetaUrlTwitter = document.createElement('meta');
        newMetaUrlTwitter.setAttribute('name', 'twitter:url');
        newMetaUrlTwitter.setAttribute('content', window.location.href);

        let newMetaDescriptionNormal = document.createElement('meta');
        newMetaDescriptionNormal.setAttribute('name', 'description');
        newMetaDescriptionNormal.setAttribute('content', 'Explore climate data for cities in Africa');

        // Append new meta tags to head
        document.head.appendChild(newMetaTitle);
        document.head.appendChild(newMetaDescriptionOG);
        document.head.appendChild(newMetaUrlOG);
        document.head.appendChild(newMetaTitleTwitter);
        document.head.appendChild(newMetaDescriptionTwitter);
        document.head.appendChild(newMetaUrlTwitter);
        document.head.appendChild(newMetaDescriptionNormal);
    };

    const values = {
        convertCountry,
        setDateRange,
        setPosition,
        setCity,
        setCountry,
        findAddress,
        setExtraLocation,
        changeDateRange,
        getAnomalyColor,
        downloadData,

        loading,
        cities,
        countries,
        dateRange,
        position,
        city,
        country,
        address,
        extraLocation,
        temperatureScale,
        monthNames,
        annualAvgTemperature,
        annualAvgPrecipitation,
        annualAvgAQ,
        maxPrecipitation,
        airQualityData,
        airQualityScale,
        airQualityAverages,
        airQuality,
        currentData
    };

    return (
        <AppContext.Provider value={values}>
            {children}
        </AppContext.Provider>
    );
}