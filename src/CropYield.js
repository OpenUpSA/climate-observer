import { useEffect, useContext, useState } from 'react';
import { AppContext } from './AppContext';
import supabase from './supabase';

import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';
import Form from 'react-bootstrap/Form';
import Dropdown from 'react-bootstrap/Dropdown';

import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

import ReactCountryFlag from 'react-country-flag';
import { Icon } from '@mdi/react';
import { mdiDownload } from '@mdi/js';

// Crop coefficient (Kc_mid) data — FAO-56
export const CROPS = [
    { name: 'Maize (grain)',    kc_mid: 1.20, notes: 'Most critical food security crop' },
    { name: 'Maize (sweet)',    kc_mid: 1.15 },
    { name: 'Sorghum',         kc_mid: 1.05 },
    { name: 'Millet',          kc_mid: 1.00 },
    { name: 'Wheat',           kc_mid: 1.15 },
    { name: 'Rice (paddy)',     kc_mid: 1.20, notes: 'Flooded conditions' },
    { name: 'Groundnut',       kc_mid: 1.15 },
    { name: 'Soybean',         kc_mid: 1.15 },
    { name: 'Sunflower',       kc_mid: 1.075 },
    { name: 'Cotton',          kc_mid: 1.175 },
    { name: 'Sugarcane',       kc_mid: 1.25 },
    { name: 'Cassava (yr 1)',  kc_mid: 0.80, notes: 'Drought-tolerant' },
    { name: 'Cassava (yr 2)',  kc_mid: 1.10 },
    { name: 'Beans (green)',   kc_mid: 1.10 },
    { name: 'Beans (dry)',     kc_mid: 1.15 },
    { name: 'Tomato',          kc_mid: 1.15 },
];

// Crop shown until a different one is picked
export const DEFAULT_CROP = 'Maize (grain)';

export function getCrop(name) {
    return CROPS.find(c => c.name === name) || CROPS.find(c => c.name === DEFAULT_CROP) || CROPS[0];
}

// The WRSI stored for each location is computed for a standardised reference
// crop. A crop that needs more water has a higher Kc_mid, so the index for a
// crop is that standardised value divided by the crop's Kc_mid.
export function cropWRSI(value, kcMid) {
    if (value == null || !isFinite(value) || !kcMid) return null;
    return Math.min(100, Math.max(0, value / kcMid));
}

// All known metric columns from the crops table (WRSI first as default)
const METRIC_OPTIONS = [
    'WRSI',
    'Evap_tavg',
    'LWdown_f_tavg',
    'Lwnet_tavg',
    'Psurf_f_tavg',
    'Qair_f_tavg',
    'Qg_tavg',
    'Qh_tavg',
    'Qle_tavg',
    'Qs_tavg',
    'Qsb_tavg',
    'RadT_tavg',
    'Rainf_f_tavg',
    'SWE_inst',
    'SWdown_f_tavg',
    'SnowCover_inst',
    'SnowDepth_inst',
    'Snowf_tavg',
    'Swnet_tavg',
    'Tair_f_tavg',
    'Wind_f_tavg',
    'SoilMoi00_10cm_tavg',
    'SoilMoi10_40cm_tavg',
    'SoilMoi40_100cm_tavg',
    'SoilMoi100_200cm_tavg',
    'SoilTemp00_10cm_tavg',
    'SoilTemp10_40cm_tavg',
    'SoilTemp40_100cm_tavg',
    'SoilTemp100_200cm_tavg',
];

function humanizeMetric(h) {
    return h.replaceAll('_', ' ').replace(/\s+/g, ' ').trim();
}

function linearRegression(xs, ys) {
    const n = xs.length;
    if (n < 2) return { m: 0, b: ys[0] ?? 0 };
    const sumX = xs.reduce((a, b) => a + b, 0);
    const sumY = ys.reduce((a, b) => a + b, 0);
    const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
    const sumX2 = xs.reduce((s, x) => s + x * x, 0);
    const denom = n * sumX2 - sumX * sumX;
    const m = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
    const b = (sumY - m * sumX) / n;
    return { m, b };
}

function addTrend(rows, xKey, yKey) {
    const xs = rows.map(r => r[xKey]);
    const ys = rows.map(r => r[yKey]);
    const { m, b } = linearRegression(xs, ys);
    return rows.map(r => ({ ...r, trend: parseFloat((m * r[xKey] + b).toFixed(4)) }));
}

const CropYield = ({ crop, onCropChange }) => {
    const { position, dateRange, monthNames, downloadData, cities, city, country, convertCountry, address } = useContext(AppContext);

    const [metric, setMetric] = useState('WRSI');
    const [fallbackCrop, setFallbackCrop] = useState(DEFAULT_CROP);
    const [selectedMonth, setSelectedMonth] = useState(1);
    const [allData, setAllData] = useState([]);
    const [annualData, setAnnualData] = useState([]);
    const [monthlyData, setMonthlyData] = useState([]);
    const [loading, setLoading] = useState(false);

    // The crop selection is owned by the parent (Co2) so the copy beside these
    // charts describes the same crop; fall back to local state if used alone.
    const selectedCrop = getCrop(crop ?? fallbackCrop);
    const changeCrop = onCropChange ?? setFallbackCrop;
    const kcMid = selectedCrop.kc_mid;
    const seriesLabel = `WRSI — ${selectedCrop.name}`;

    // Fetch from Supabase whenever position or dateRange changes
    useEffect(() => {
        if (!position || position.length < 2) return;
        setLoading(true);

        const fetchData = async () => {
            const { data, error } = await supabase
                .from('crops')
                .select('*')
                .gt('latitude', parseFloat(position[0]) - 0.5)
                .lt('latitude', parseFloat(position[0]) + 0.5)
                .gt('longitude', parseFloat(position[1]) - 0.5)
                .lt('longitude', parseFloat(position[1]) + 0.5)
                .limit(10000);

            if (error) {
                console.error('[CropYield] Supabase error', error);
                setAllData([]);
            } else {
                // Filter by dateRange client-side (date column is YYYY-MM)
                const filtered = (data || []).filter(row => {
                    const year = parseInt(('' + row.date).substring(0, 4));
                    return year >= dateRange[0] && year <= dateRange[1];
                });
                setAllData(filtered);
            }
            setLoading(false);
        };

        fetchData();
    }, [position, dateRange]);

    // Build annual averages chart whenever allData, metric or crop changes
    useEffect(() => {
        if (allData.length === 0) { setAnnualData([]); return; }

        const yearly = {};
        allData.forEach(row => {
            if (row[metric] == null) return;
            const year = parseInt(('' + row.date).split('-')[0]);
            if (!yearly[year]) yearly[year] = { sum: 0, count: 0 };
            yearly[year].sum += parseFloat(row[metric]);
            yearly[year].count += 1;
        });

        const rows = Object.entries(yearly)
            .map(([year, { sum, count }]) => ({
                year: parseInt(year),
                value: parseFloat(cropWRSI(sum / count, kcMid).toFixed(4)),
            }))
            .sort((a, b) => a.year - b.year);

        setAnnualData(rows.length >= 2 ? addTrend(rows, 'year', 'value') : rows);
    }, [allData, metric, kcMid]);

    // Build monthly breakdown chart whenever allData, selectedMonth or crop changes
    useEffect(() => {
        if (allData.length === 0) { setMonthlyData([]); return; }

        const rows = allData
            .filter(row => {
                const parts = ('' + row.date).split('-');
                return parseInt(parts[1]) === parseInt(selectedMonth) && row['WRSI'] != null;
            })
            .map(row => ({
                year: parseInt(('' + row.date).split('-')[0]),
                value: parseFloat(row['WRSI']),
            }))
            .sort((a, b) => a.year - b.year);

        // Average the raw values per year (multiple grid cells may exist) and scale
        // by Kc afterwards. Clipping each cell before averaging would understate a
        // year where one cell had more water than the crop needs.
        const byYear = {};
        rows.forEach(r => {
            if (!byYear[r.year]) byYear[r.year] = { sum: 0, count: 0 };
            byYear[r.year].sum += r.value;
            byYear[r.year].count += 1;
        });
        const averaged = Object.entries(byYear)
            .map(([year, { sum, count }]) => ({
                year: parseInt(year),
                value: parseFloat(cropWRSI(sum / count, kcMid).toFixed(4)),
            }))
            .sort((a, b) => a.year - b.year);

        setMonthlyData(averaged.length >= 2 ? addTrend(averaged, 'year', 'value') : averaged);
    }, [allData, selectedMonth, kcMid]);

    const handleMonthChange = (e) => setSelectedMonth(parseInt(e.target.value));
    const handleCropChange = (e) => changeCrop(e.target.value);

    const cropSelect = (
        <Form.Select value={selectedCrop.name} onChange={handleCropChange} aria-label="Crop" title="Crop">
            {CROPS.map(c => (
                <option key={c.name} value={c.name}>{c.name} — Kc {c.kc_mid.toFixed(2)}</option>
            ))}
        </Form.Select>
    );

    return (
        <>
            {/* Chart 1 – Annual averages */}
            <section className="chart-wrapper">
                <header>
                    <h3>Annual water requirement satisfaction for {selectedCrop.name} in <span className="location-highlight">
                        <div className="country-flag-circle"><ReactCountryFlag countryCode={convertCountry('iso3', country).iso2} svg /></div>
                        <span>{city !== '' && city !== 'location' ? cities.filter(c => c.city.replaceAll(' ', '-').toLowerCase() === city)[0]?.city : address}</span>
                    </span> from {dateRange[0]} to {dateRange[1]}</h3>
                </header>

                <div className="chart-controls">
                    <Row className="justify-content-between">
                        <Col xs="auto">
                            {cropSelect}
                        </Col>
                        <Col xs="auto">
                            <Dropdown>
                                <Dropdown.Toggle>
                                    <Icon path={mdiDownload} size={1} /> Download
                                </Dropdown.Toggle>
                                <Dropdown.Menu>
                                    <Dropdown.Item onClick={() => downloadData('csv', 'crop-annual', null, { crop: selectedCrop.name, rows: annualData })}>CSV</Dropdown.Item>
                                    <Dropdown.Item onClick={() => downloadData('png', 'crop-annual')}>PNG</Dropdown.Item>
                                </Dropdown.Menu>
                            </Dropdown>
                        </Col>
                    </Row>
                </div>

                <div className="chart-export" id="crop-annual">
                    <div className="chart-container">
                        {loading && <p className="text-center text-muted py-4">Loading…</p>}
                        {!loading && annualData.length === 0 && (
                            <p className="text-center text-muted py-4">No data available for this location and date range.</p>
                        )}
                        {!loading && annualData.length > 0 && (
                            <ResponsiveContainer width="100%" height={250}>
                                <ComposedChart data={annualData} margin={{ top: 0, right: 40, bottom: 20, left: 0 }}>
                                    <XAxis dataKey="year" />
                                    <YAxis />
                                    <Tooltip />
                                    <CartesianGrid stroke="#f5f5f5" />
                                    <Line type="monotone" dataKey="value" stroke="#2b8cbe" dot={false} strokeWidth={2} name={seriesLabel} />
                                    <Line type="linear" dataKey="trend" stroke="#de2d26" dot={false} strokeWidth={1} strokeDasharray="3 3" name="Trend" />
                                </ComposedChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                    <footer>
                        <Row>
                            <Col>
                                <span className="legend-item"><span className="line-sample" style={{ background: '#2b8cbe' }}></span> {seriesLabel} (Kc mid {kcMid.toFixed(2)})</span>
                                <span className="legend-item"><span className="line-sample dashed" style={{ background: '#de2d26' }}></span> Trend</span>
                            </Col>
                            <Col className="text-end text-muted small">
                                Source: <a href="https://disc.gsfc.nasa.gov/datasets/FLDAS_NOAH01_C_GL_M_001/summary?keywords=FLDAS" target="_blank" rel="noreferrer">FLDAS Noah Land Surface Model</a>
                            </Col>
                        </Row>
                    </footer>
                </div>
            </section>

            {/* Chart 2 – Monthly breakdown */}
            <section className="chart-wrapper" style={{ marginTop: '2rem' }}>
                <header>
                    <h3>Monthly water requirement satisfaction for {selectedCrop.name} in <span className="location-highlight">
                        <div className="country-flag-circle"><ReactCountryFlag countryCode={convertCountry('iso3', country).iso2} svg /></div>
                        <span>{city !== '' && city !== 'location' ? cities.filter(c => c.city.replaceAll(' ', '-').toLowerCase() === city)[0]?.city : address}</span>
                    </span> from {dateRange[0]} to {dateRange[1]}</h3>
                </header>

                <div className="chart-controls">
                    <Row className="justify-content-between">
                        <Col xs="auto">
                            {cropSelect}
                        </Col>
                        <Col xs="auto">
                            <Form.Select value={selectedMonth} onChange={handleMonthChange}>
                                {monthNames.map((name, i) => (
                                    <option key={i + 1} value={i + 1}>{name}</option>
                                ))}
                            </Form.Select>
                        </Col>
                        <Col xs="auto">
                            <Dropdown>
                                <Dropdown.Toggle>
                                    <Icon path={mdiDownload} size={1} /> Download
                                </Dropdown.Toggle>
                                <Dropdown.Menu>
                                    <Dropdown.Item onClick={() => downloadData('csv', 'crop-monthly-breakdown', selectedMonth, { crop: selectedCrop.name, rows: monthlyData })}>CSV</Dropdown.Item>
                                    <Dropdown.Item onClick={() => downloadData('png', 'crop-monthly-breakdown', selectedMonth)}>PNG</Dropdown.Item>
                                </Dropdown.Menu>
                            </Dropdown>
                        </Col>
                    </Row>
                </div>

                <div className="chart-export" id="crop-monthly-breakdown">
                    <div className="chart-container">
                        {loading && <p className="text-center text-muted py-4">Loading…</p>}
                        {!loading && monthlyData.length === 0 && (
                            <p className="text-center text-muted py-4">No data available for this month and location.</p>
                        )}
                        {!loading && monthlyData.length > 0 && (
                            <ResponsiveContainer width="100%" height={250}>
                                <ComposedChart data={monthlyData} margin={{ top: 0, right: 40, bottom: 20, left: 0 }}>
                                    <XAxis dataKey="year" />
                                    <YAxis />
                                    <Tooltip />
                                    <CartesianGrid stroke="#f5f5f5" />
                                    <Line type="monotone" dataKey="value" stroke="#2b8cbe" dot={false} strokeWidth={2} name={seriesLabel} />
                                    <Line type="linear" dataKey="trend" stroke="#de2d26" dot={false} strokeWidth={1} strokeDasharray="3 3" name="Trend" />
                                </ComposedChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                    <footer>
                        <Row>
                            <Col>
                                <span className="legend-item"><span className="line-sample" style={{ background: '#2b8cbe' }}></span> {seriesLabel} ({monthNames[selectedMonth - 1]})</span>
                                <span className="legend-item"><span className="line-sample dashed" style={{ background: '#de2d26' }}></span> Trend</span>
                            </Col>
                            <Col className="text-end text-muted small">
                                Source: <a href="https://disc.gsfc.nasa.gov/datasets/FLDAS_NOAH01_C_GL_M_001/summary?keywords=FLDAS" target="_blank" rel="noreferrer">FLDAS Noah Land Surface Model</a>
                            </Col>
                        </Row>
                    </footer>
                </div>
            </section>

        </>
    );
};

export default CropYield;
