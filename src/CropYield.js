import { useEffect, useContext, useState } from 'react';
import { AppContext } from './AppContext';
import supabase from './supabase';

import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';
import Form from 'react-bootstrap/Form';
import Dropdown from 'react-bootstrap/Dropdown';

import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

import Table from 'react-bootstrap/Table';

import ReactCountryFlag from 'react-country-flag';
import { Icon } from '@mdi/react';
import { mdiDownload } from '@mdi/js';

// Crop coefficient (Kc_mid) data — FAO-56
const CROPS = [
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

const CropYield = () => {
    const { position, dateRange, monthNames, downloadData, cities, city, country, convertCountry, address } = useContext(AppContext);

    const [metric, setMetric] = useState('WRSI');
    const [selectedMonth, setSelectedMonth] = useState(1);
    const [allData, setAllData] = useState([]);
    const [annualData, setAnnualData] = useState([]);
    const [monthlyData, setMonthlyData] = useState([]);
    const [loading, setLoading] = useState(false);

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

    // Build annual averages chart whenever allData or metric changes
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
            .map(([year, { sum, count }]) => ({ year: parseInt(year), value: parseFloat((sum / count).toFixed(4)) }))
            .sort((a, b) => a.year - b.year);

        setAnnualData(rows.length >= 2 ? addTrend(rows, 'year', 'value') : rows);
    }, [allData, metric]);

    // Build monthly breakdown chart whenever allData or selectedMonth changes (always uses WRSI)
    useEffect(() => {
        if (allData.length === 0) { setMonthlyData([]); return; }

        const rows = allData
            .filter(row => {
                const parts = ('' + row.date).split('-');
                return parseInt(parts[1]) === parseInt(selectedMonth) && row['WRSI'] != null;
            })
            .map(row => ({
                year: parseInt(('' + row.date).split('-')[0]),
                value: parseFloat(parseFloat(row['WRSI']).toFixed(4)),
            }))
            .sort((a, b) => a.year - b.year);

        // average per year (multiple grid cells may exist)
        const byYear = {};
        rows.forEach(r => {
            if (!byYear[r.year]) byYear[r.year] = { sum: 0, count: 0 };
            byYear[r.year].sum += r.value;
            byYear[r.year].count += 1;
        });
        const averaged = Object.entries(byYear)
            .map(([year, { sum, count }]) => ({ year: parseInt(year), value: parseFloat((sum / count).toFixed(4)) }))
            .sort((a, b) => a.year - b.year);

        setMonthlyData(averaged.length >= 2 ? addTrend(averaged, 'year', 'value') : averaged);
    }, [allData, selectedMonth]);

    const handleMonthChange = (e) => setSelectedMonth(parseInt(e.target.value));

    return (
        <>
            {/* Chart 1 – Annual averages */}
            <section className="chart-wrapper">
                <header>
                    <h3>Crop metrics in <span className="location-highlight">
                        <div className="country-flag-circle"><ReactCountryFlag countryCode={convertCountry('iso3', country).iso2} svg /></div>
                        <span>{city !== '' && city !== 'location' ? cities.filter(c => c.city.replaceAll(' ', '-').toLowerCase() === city)[0]?.city : address}</span>
                    </span> from {dateRange[0]} to {dateRange[1]}</h3>
                </header>

                <div className="chart-controls">
                    <Row className="justify-content-between">
                        <Col xs="auto">
                           
                        </Col>
                        <Col xs="auto">
                            <Dropdown>
                                <Dropdown.Toggle>
                                    <Icon path={mdiDownload} size={1} /> Download
                                </Dropdown.Toggle>
                                <Dropdown.Menu>
                                    <Dropdown.Item onClick={() => downloadData('csv', 'crop-annual')}>CSV</Dropdown.Item>
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
                                    <Line type="monotone" dataKey="value" stroke="#2b8cbe" dot={false} strokeWidth={2} name={humanizeMetric(metric)} />
                                    <Line type="linear" dataKey="trend" stroke="#de2d26" dot={false} strokeWidth={1} strokeDasharray="3 3" name="Trend" />
                                </ComposedChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                    <footer>
                        <Row>
                            <Col>
                                <span className="legend-item"><span className="line-sample" style={{ background: '#2b8cbe' }}></span> {humanizeMetric(metric)}</span>
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
                    <h3>Monthly Water Requirement Satisfaction Index for <span className="location-highlight">
                        <div className="country-flag-circle"><ReactCountryFlag countryCode={convertCountry('iso3', country).iso2} svg /></div>
                        <span>{city !== '' && city !== 'location' ? cities.filter(c => c.city.replaceAll(' ', '-').toLowerCase() === city)[0]?.city : address}</span>
                    </span> from {dateRange[0]} to {dateRange[1]}</h3>
                </header>

                <div className="chart-controls">
                    <Row className="justify-content-between">
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
                                    <Dropdown.Item onClick={() => downloadData('csv', 'crop-monthly-breakdown', selectedMonth)}>CSV</Dropdown.Item>
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
                                    <Line type="monotone" dataKey="value" stroke="#2b8cbe" dot={false} strokeWidth={2} name="WRSI" />
                                    <Line type="linear" dataKey="trend" stroke="#de2d26" dot={false} strokeWidth={1} strokeDasharray="3 3" name="Trend" />
                                </ComposedChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                    <footer>
                        <Row>
                            <Col>
                                <span className="legend-item"><span className="line-sample" style={{ background: '#2b8cbe' }}></span> WRSI ({monthNames[selectedMonth - 1]})</span>
                                <span className="legend-item"><span className="line-sample dashed" style={{ background: '#de2d26' }}></span> Trend</span>
                            </Col>
                            <Col className="text-end text-muted small">
                                Source: <a href="https://disc.gsfc.nasa.gov/datasets/FLDAS_NOAH01_C_GL_M_001/summary?keywords=FLDAS" target="_blank" rel="noreferrer">FLDAS Noah Land Surface Model</a>
                            </Col>
                        </Row>
                    </footer>
                </div>
            </section>

            {/* Crop stress table */}
            {annualData.length > 0 && (() => {
                const avgWRSI = annualData.reduce((s, r) => s + r.value, 0) / annualData.length;

                const getStress = (implied) => {
                    if (implied >= 90) return { label: 'No stress',           color: '#1a9641' };
                    if (implied >= 70) return { label: 'Mild stress',         color: '#a6d96a' };
                    if (implied >= 50) return { label: 'Moderate stress',     color: '#fdae61' };
                    if (implied >= 30) return { label: 'Severe stress',       color: '#d7191c' };
                    return                     { label: 'Crop failure risk',  color: '#7b0000' };
                };

                const STRESS_SCALE = [
                    { range: '90–100', label: 'No stress',          color: '#1a9641' },
                    { range: '70–89',  label: 'Mild stress',        color: '#a6d96a' },
                    { range: '50–69',  label: 'Moderate stress',    color: '#fdae61' },
                    { range: '30–49',  label: 'Severe stress',      color: '#d7191c' },
                    { range: '< 30',   label: 'Crop failure risk',  color: '#7b0000' },
                ];

                return (
                    <section className="chart-wrapper" style={{ marginTop: '2rem' }}>
                        <header>
                            <h3>Crop water stress in <span className="location-highlight">
                                <div className="country-flag-circle"><ReactCountryFlag countryCode={convertCountry('iso3', country).iso2} svg /></div>
                                <span>{city !== '' && city !== 'location' ? cities.filter(c => c.city.replaceAll(' ', '-').toLowerCase() === city)[0]?.city : address}</span>
                            </span> from {dateRange[0]} to {dateRange[1]}</h3>
                            <p className="small mb-0" style={{ color: 'white' }}>
                                Based on average WRSI of <strong>{avgWRSI.toFixed(1)}</strong> for this location and period.
                                Implied crop WRSI = WRSI ÷ Kc<sub>mid</sub>.
                            </p>
                        </header>

                        <div className="table-container">
                            <Table striped hover>
                                <thead>
                                    <tr>
                                        <th>Crop</th>
                                        <th style={{ width: '80px' }} className="text-end">Kc mid</th>
                                        <th style={{ width: '120px' }} className="text-end">Implied WRSI</th>
                                        <th style={{ width: '160px' }} className="text-end">Stress category</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {CROPS.map(crop => {
                                        const implied = avgWRSI / crop.kc_mid;
                                        const { label, color } = getStress(implied);
                                        return (
                                            <tr key={crop.name}>
                                                <td>{crop.name}</td>
                                                <td className="text-end">{crop.kc_mid.toFixed(2)}</td>
                                                <td className="text-end">{implied.toFixed(1)}</td>
                                                <td className="text-end">
                                                    {label}
                                                    <div className="legend-box" style={{ backgroundColor: color }}></div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </Table>
                        </div>

                        <footer>
                            <Row>
                                <Col>
                                    {STRESS_SCALE.map(s => (
                                        <div key={s.range} className="legend-item">
                                            <div className="legend-item-color" style={{ backgroundColor: s.color }}></div>
                                            <div className="legend-item-label">{s.range} — {s.label}</div>
                                        </div>
                                    ))}
                                </Col>
                                <Col xs="auto" className="text-muted small align-self-end">
                                    Source: <a href="https://www.fao.org/4/x0490e/x0490e00.htm" target="_blank" rel="noreferrer">FAO-56 crop coefficients</a>
                                </Col>
                            </Row>
                        </footer>
                    </section>
                );
            })()}
        </>
    );
};

export default CropYield;
