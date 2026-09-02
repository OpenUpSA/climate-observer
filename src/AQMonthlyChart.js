import { useEffect, useContext, useState } from "react";
import { AppContext } from "./AppContext";

import ReactCountryFlag from 'react-country-flag';

import Container from 'react-bootstrap/Container';
import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Dropdown from 'react-bootstrap/Dropdown';

import ReactHtmlParser, { processNodes, convertNodeToElement, htmlparser2 } from 'react-html-parser';

import { Icon } from '@mdi/react';
import { mdiCog, mdiDownload, mdiFridgeIndustrialAlertOutline, mdiShare, mdiShareVariant } from '@mdi/js';

import SocialShare from "./SocialShare";


const AQMonthlyChart = () => {

    const { cities, city, country, convertCountry, address, currentData, dateRange, monthNames, downloadData, airQualityData, airQuality, airQualityScale } = useContext(AppContext);

    const [chartData, setChartData] = useState([]);

    const [tooltip, setTooltip] = useState(null);
   
    
    useEffect(() => {

        let heatmapData = [];

        for (let i = 1; i <= 12; i++) {
            heatmapData.push({key: monthNames[i-1], data: []});
        }

        let years = [...new Set(airQualityData.map(a => a.year))];
        let airQualityDataByYear = years.map(y => {
            return {
                year: y,
                data: airQualityData.filter(a => a.year == y)
            }
        });

        airQualityDataByYear = airQualityDataByYear.reverse();

        setChartData(airQualityDataByYear);
    
    }, [airQualityData]);

   useEffect(() => {
    console.log(chartData)
    }, [chartData]);


    return (
        <section className="chart-wrapper">
            
            <header>
                {<h3>
                    
                    {
                        <>Monthly air quality (aerosol optical depth) in <span className="location-highlight">
                                <div className="country-flag-circle"><ReactCountryFlag countryCode={convertCountry('iso3',country).iso2} svg /></div> 
                                <span>{ city != '' && city != 'location' ? cities.filter(c => c.city.replaceAll(' ','-').toLowerCase() == city)[0].city : address }</span>
                            </span> from {dateRange[0] < 2003 ? 2003 : dateRange[0]} to {dateRange[1]}</>
                    }
                </h3>}
            </header>
            
            <div className="chart-controls">
                <Row className="justify-content-between">
                    <Col xs="auto">
                        
                    </Col>
                    <Col xs="auto">
                        <Row>
                            
                            <Col xs="auto">
                                <Dropdown>
                                    <Dropdown.Toggle>
                                        <Icon path={mdiDownload} size={1} /> Download
                                    </Dropdown.Toggle>

                                    <Dropdown.Menu>
                                        <Dropdown.Item onClick={() => downloadData('csv','monthly-air-quality')}>CSV</Dropdown.Item>
                                        <Dropdown.Item onClick={() => downloadData('png','monthly-air-quality')}>PNG</Dropdown.Item>
                                    </Dropdown.Menu>
                                </Dropdown>
                            </Col>
                            <Col xs="auto">
                                <SocialShare chart="monthly-air-quality" />
                            </Col>
                           
                        </Row>
                    </Col>
                </Row>                
            </div>

                      
            <div className="chart-export" id="monthly-air-quality">
                
                <div className="chart-container air-quality-chart-container my-4">
                    
                    {chartData.map((d,i) => {
                        return <div className="heatmap-row" key={i}>
                            <div className="heatmap-year"><div className="heatmap-year-text">{d.year}</div></div>
                            {
                                d.data.map((m,j) => {
                                    return <div className={`heatmap-cell ${tooltip && tooltip.year == m.year && tooltip.month_number == m.month_number && 'active'}`} key={j} style={{backgroundColor: isNaN(m.aod_mean) ? '#fff' : m.aod_mean < 0 ? airQualityScale[0].color : airQualityScale.filter(aq => m.aod_mean >= aq.min && m.aod_mean <= aq.max)[0]?.color}} onMouseEnter={() => setTooltip(m)} onMouseLeave={() => setTooltip(null)}>
                                        {
                                            tooltip && tooltip.year == m.year && tooltip.month_number == m.month_number &&
                                            <Container className="custom-tooltip heatmap-tooltip">
                                            <div className="tooltip-date">{monthNames[m.month_number-1]} {m.year}</div>
                                            <Row>
                                                <Col className="tooltip-item-name">AOD</Col>
                                                <Col xs={3} className="tooltip-item-value">{isNaN(m.aod_mean) ? '---' : m.aod_mean < 0 ? 0 : m.aod_mean}</Col>
                                            </Row>
                                            <Row>
                                                <Col>
                                                    {
                                                    airQualityScale.filter(aq => m.aod_mean >= aq.min && m.aod_mean <= aq.max)[0]?.quality == 'Unhealthy for sensitive groups' ? 'Unhealthy' : airQualityScale.filter(aq => m.aod_mean >= aq.min && m.aod_mean <= aq.max)[0]?.quality
                                                    }
                                                </Col>
                                            </Row>
                                            </Container>
                                        }
                                    </div>
                                })
                            }
                        </div>
                    })}
                    <div className="heatmap-row">
                        <div className="heatmap-year"></div>
                        {
                            monthNames.map((m,i) => {
                                return <div className="heatmap-cell heatmap-month" key={i}>{m.substring(0,3)}</div>
                            })
                        }
                    </div>

                </div>

                <footer>
                    <Row className="justify-content-between">
                        <Col>
                            <div className="air-quality-guage">
                                {
                                    airQualityScale.map((item, index) => {
                                        return (
                                            <div className="air-quality-guage-segment" key={index} style={{backgroundColor: item.color}}>
                                                {item.short_label}
                                            </div>
                                        )
                                    })
                                }
                            </div>
                        </Col>
                        <Col xs="auto">
                            Data source: <a target="_blank" href="https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/MYD08_M3#overview">MODIS</a>
                        </Col>
                    </Row>
                </footer>
            </div>
        
        </section>
    )

}

export default AQMonthlyChart;