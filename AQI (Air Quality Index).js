/**
 * Version: 5.2.3 (Build 35)
 * Partitially created and modified by Dylan Wettstein, 2022.
 * Report bugs by contacting me: contact@dylanwettstein.com
 * Get the newest version by contacting me: contact@dylanwettstein.com
 * Credits: Unknown. Claim by contacting me: contact@dylanwettstein.com
 * Do not sell this script without the confirmation of the developer.
 */

"use strict";

const API_URL = "https://www.purpleair.com";

var version = "5.2.3"

console.log ("Version " + version)

/**
 * Find a nearby PurpleAir sensor ID via https://fire.airnow.gov/
 * Click a sensor near your location: the ID is the trailing integers
 * https://www.purpleair.com/json has all sensors by location & ID.
 * @type {number}
 */

//const SENSOR_ID = args.widgetParameter;
const SENSOR_ID = args.null

/**
 * Widget attributes: AQI level threshold, text label, gradient start and end colors, text color
 *
 * @typedef {object} LevelAttribute
 * @property {number} threshold
 * @property {string} label
 * @property {string} startColor
 * @property {string} endColor
 * @property {string} textColor
 * @property {string} darkStartColor
 * @property {string} darkEndColor
 * @property {string} darkTextColor
 * @property {string} sfSymbol
 */

/**
 * @typedef {object} SensorData
 * @property {string} val
 * @property {string} adj1
 * @property {string} [adj2]
 * @property {number} ts
 * @property {string} hum
 * @property {string} loc
 * @property {string} lat
 * @property {string} lon
 */

/**
 * @typedef {object} LatLon
 * @property {number} latitude
 * @property {number} longitude
 */

/**
 * Get JSON from a local file
 *
 * @param {string} fileName
 * @returns {object}
 */
function getCachedData(fileName) {
  const fileManager = FileManager.local();
  const cacheDirectory = fileManager.joinPath(fileManager.libraryDirectory(), "jsnell-aqi");
  const cacheFile = fileManager.joinPath(cacheDirectory, fileName);

  if (!fileManager.fileExists(cacheFile)) {
    return undefined;
  }

  const contents = fileManager.readString(cacheFile);
  return JSON.parse(contents);
}

/**
 * Wite JSON to a local file
 *
 * @param {string} fileName
 * @param {object} data
 */
function cacheData(fileName, data) {
  const fileManager = FileManager.local();
  const cacheDirectory = fileManager.joinPath(fileManager.libraryDirectory(), "jsnell-aqi");
  const cacheFile = fileManager.joinPath(cacheDirectory, fileName);

  if (!fileManager.fileExists(cacheDirectory)) {
    fileManager.createDirectory(cacheDirectory);
  }

  const contents = JSON.stringify(data);
  fileManager.writeString(cacheFile, contents);
}

/**
 * Get the closest PurpleAir sensorId to the given location
 *
 * @returns {Promise<number>}
 */
async function getSensorId() {
  if (SENSOR_ID) return SENSOR_ID;

  let fallbackSensorId = undefined;

  try {
    const cachedSensor = getCachedData("sensor.json");
    if (cachedSensor) {
      console.log({ cachedSensor });

      const { id, updatedAt } = cachedSensor;
      fallbackSensorId = id;
      // If we've fetched the location within the last 15 minutes, just return it
      if (Date.now() - updatedAt < 5 * 60 * 1000) {
        return id;
      }
    }

    /** @type {LatLon} */
    const { latitude, longitude } = await Location.current();

    const BOUND_OFFSET = 0.2;

    const nwLat = latitude + BOUND_OFFSET;
    const seLat = latitude - BOUND_OFFSET;
    const nwLng = longitude - BOUND_OFFSET;
    const seLng = longitude + BOUND_OFFSET;

    const req = new Request(
      `${API_URL}/json?exclude=true&nwlat=${nwLat}&selat=${seLat}&nwlng=${nwLng}&selng=${seLng}`
    );

    /** @type {{ code?: number; results?: Array<Object<string, number|string>>; }} */
    const res = await req.loadJSON();

    const { results } = res;

    const sensorIdField = "ID";
    const latField = "Lat";
    const lonField = "Lon";
    const locationField = "DEVICE_LOCATIONTYPE";
    const ageField = "AGE";
    const OUTDOOR = "outside";

    let closestSensor;
    let closestDistance = Infinity;

    for (const location of results.filter((datum) => datum[locationField] === OUTDOOR && datum[ageField] < 60 * 4)) {
      const distanceFromLocation = haversine(
        { latitude, longitude },
        { latitude: location[latField], longitude: location[lonField] }
      );
      if (distanceFromLocation < closestDistance) {
        closestDistance = distanceFromLocation;
        closestSensor = location;
      }
    }

    const id = closestSensor[sensorIdField];
    cacheData("sensor.json", { id, updatedAt: Date.now() });

    return id;
  } catch (error) {
    console.log(`Could not fetch location: ${error}`);
    return fallbackSensorId;
  }
}

/**
 * Returns the haversine distance between start and end.
 *
 * @param {LatLon} start
 * @param {LatLon} end
 * @returns {number}
 */
function haversine(start, end) {
  const toRadians = (n) => (n * Math.PI) / 180;

  const deltaLat = toRadians(end.latitude - start.latitude);
  const deltaLon = toRadians(end.longitude - start.longitude);
  const startLat = toRadians(start.latitude);
  const endLat = toRadians(end.latitude);

  const angle =
    Math.sin(deltaLat / 2) ** 2 +
    Math.sin(deltaLon / 2) ** 2 * Math.cos(startLat) * Math.cos(endLat);

  return 2 * Math.atan2(Math.sqrt(angle), Math.sqrt(1 - angle));
}

/**
 * Fetch content from PurpleAir
 *
 * @param {number} sensorId
 * @returns {Promise<SensorData>}
 */
async function getSensorData(sensorId) {
  const sensorCache = `sensor-${sensorId}-data.json`;
  const req = new Request(`${API_URL}/json?show=${sensorId}`);
  let json = await req.loadJSON();

  try {
    // Check that our results are what we expect
    if (json && json.results && Array.isArray(json.results) && json.results.length > 1) {
      console.log(`Sensor data looks good, will cache.`);
      const sensorData = { json, updatedAt: Date.now() }
      cacheData(sensorCache, sensorData);
    } else {
      const { json: cachedJson, updatedAt } = getCachedData(sensorCache);
      if (Date.now() - updatedAt > 2 * 60 * 60 * 1000) {
        // Bail if our data is > 2 hours old
        throw `Our cache is too old: ${updatedAt }`;
      }
      console.log(`Using cached sensor data: ${updatedAt}`);
      json = cachedJson;
    }
    return {
      val: json.results[0].Stats,
      adj1: json.results[0].pm2_5_cf_1,
      adj2: json.results[1].pm2_5_cf_1,
      ts: json.results[0].LastSeen,
      hum: json.results[0].humidity,
      loc: json.results[0].Label,
      lat: json.results[0].Lat,
      lon: json.results[0].Lon,
    };
  } catch (error) {
    console.log(`Could not parse JSON: ${error}`);
    throw 666;
  }
}

/**
 * Fetch reverse geocode
 *
 * @param {string} lat
 * @param {string} lon
 * @returns {Promise<GeospatialData>}
 */
async function getGeoData(lat, lon) {
  const latitude = Number.parseFloat(lat);
  const longitude = Number.parseFloat(lon);

  const geo = await Location.reverseGeocode(latitude, longitude);
  console.log({ geo: geo });

  return {
    neighborhood: geo[0].subLocality,
    city: geo[0].locality,
    state: geo[0].administrativeArea,
  };
}

/**
 * Fetch a renderable location
 *
 * @param {SensorData} data
 * @returns {Promise<String>}
 */
async function getLocation(data) {
  try {
    if (args.widgetParameter) {
      return data.loc;
    }

    const geoData = await getGeoData(data.lat, data.lon);
    console.log({ geoData });

    if (geoData.neighborhood && geoData.city) {
        return `${geoData.neighborhood}, ${geoData.city}`;
    } else {
        return geoData.city || data.loc;
    }
  } catch (error) {
    console.log(`Could not cleanup location: ${error}`);
    return data.loc;
  }
}

/** @type {Array<LevelAttribute>} sorted by threshold desc. */
const LEVEL_ATTRIBUTES = [
  {
    threshold: 300,
    label: "Hazardous",
    startColor: "76205d",
    endColor: "521541",
    textColor: "f0f0f0",
    darkStartColor: "333333",
    darkEndColor: "000000",
    darkTextColor: "ce4ec5",
    sfSymbol: "aqi.high",
  },
  {
    threshold: 200,
    label: "Very Unhealthy",
    startColor: "9c2424",
    endColor: "661414",
    textColor: "f0f0f0",
    darkStartColor: "333333",
    darkEndColor: "000000",
    darkTextColor: "f33939",
    sfSymbol: "aqi.high",
  },
  {
    threshold: 150,
    label: "Unhealthy",
    startColor: "da5340",
    endColor: "bc2f26",
    textColor: "eaeaea",
    darkStartColor: "333333",
    darkEndColor: "000000",
    darkTextColor: "f16745",
    sfSymbol: "aqi.high",
  },
  {
    threshold: 100,
    label: "Unhealthy for Sensitive Groups",
    startColor: "f5ba2a",
    endColor: "d3781c",
    textColor: "1f1f1f",
    darkStartColor: "333333",
    darkEndColor: "000000",
    darkTextColor: "f7a021",
    sfSymbol: "aqi.medium",
  },
  {
    threshold: 50,
    label: "Moderate",
    startColor: "f2e269",
    endColor: "dfb743",
    textColor: "1f1f1f",
    darkStartColor: "333333",
    darkEndColor: "000000",
    darkTextColor: "f2e269",
    sfSymbol: "aqi.low",
  },
  {
    threshold: -1,
    label: "Good",
    startColor: "8fec74",
    endColor: "77c853",
    textColor: "1f1f1f",
    darkStartColor: "333333",
    darkEndColor: "000000",
    darkTextColor: "6de46d",
    sfSymbol: "aqi.low",
  },
  {
    threshold: -25,
    label: "Unavailable",
    startColor: "FFFFFF",
    endColor: "CCCCCC",
    textColor: "FF0000",
    darkStartColor: "333333",
    darkEndColor: "000000",
    darkTextColor: "FF0000",
    sfSymbol: "exclamationmark.triangle",
  },
];




/**
 * Get the EPA adjusted PPM
 *
 * @param {SensorData} sensorData
 * @returns {number} EPA adjustment for wood smoke and PurpleAir from slide 8 of https://cfpub.epa.gov/si/si_public_record_report.cfm?dirEntryId=349513&Lab=CEMM&simplesearch=0&showcriteria=2&sortby=pubDate&timstype=&datebeginpublishedpresented=08/25/2018
 */
function computePM(sensorData) {
  const adj1 = Number.parseInt(sensorData.adj1, 10);
  const adj2 = Number.parseInt(sensorData.adj2, 10);
  const hum = Number.parseInt(sensorData.hum, 10);
  const dataAverage = isNaN(adj2) ? adj1 : (adj1 + adj2) / 2;
  console.log(`PM2.5 number is ${dataAverage}.`)
//  if (dataAverage < 250) {
//  console.log(`Using EPA calculation.`)
    return 0.52 * dataAverage - 0.085 * hum + 5.71;
//  } else {
//   console.log(`Using AQANDU calculation.`)
//   return .0778 * dataAverage + 2.65
// }
}

/**
 * Get AQI number from PPM reading
 *
 * @param {number} pm
 * @returns {number|'-'}
 */
function aqiFromPM(pm) {
  if (pm > 350.5) return calculateAQI(pm, 500.0, 401.0, 500.0, 350.5);
  if (pm > 250.5) return calculateAQI(pm, 400.0, 301.0, 350.4, 250.5);
  if (pm > 150.5) return calculateAQI(pm, 300.0, 201.0, 250.4, 150.5);
  if (pm > 55.5) return calculateAQI(pm, 200.0, 151.0, 150.4, 55.5);
  if (pm > 35.5) return calculateAQI(pm, 150.0, 101.0, 55.4, 35.5);
  if (pm > 12.1) return calculateAQI(pm, 100.0, 51.0, 35.4, 12.1);
  if (pm >= 0.0) return calculateAQI(pm, 50.0, 0.0, 12.0, 0.0);
  return "-";
}

/**
 * Calculate the AQI number
 *
 * @param {number} Cp
 * @param {number} Ih
 * @param {number} Il
 * @param {number} BPh
 * @param {number} BPl
 * @returns {number}
 */
function calculateAQI(Cp, Ih, Il, BPh, BPl) {
  const a = Ih - Il;
  const b = BPh - BPl;
  const c = Cp - BPl;
  return Math.round((a / b) * c + Il);
}

/**
 * Calculates the AQI level
 * based on https://cfpub.epa.gov/airnow/index.cfm?action=aqibasics.aqi#unh
 *
 * @param {number|'-'} aqi
 * @returns {LevelAttribute & { level: number }}
 */
function calculateLevel(aqi) {
  const level = Number(aqi) || 0;

  const {
    label = "Weird",
    startColor = "white",
    endColor = "white",
    textColor = "black",
    darkStartColor = "009900",
    darkEndColor = "007700",
    darkTextColor = "000000",
    threshold = -Infinity,
    sfSymbol = "aqi.low",
  } = LEVEL_ATTRIBUTES.find(({ threshold }) => level > threshold) || {};

  return {
    label,
    startColor,
    endColor,
    textColor,
    darkStartColor,
    darkEndColor,
    darkTextColor,
    threshold,
    level,
    sfSymbol,
  };
}

/**
 * Get the AQI trend
 *
 * @param {{ v1: number; v3: number; }} stats
 * @returns {string}
 */
function getAQITrend({ v1: partLive, v3: partTime }) {
  const partDelta = partTime - partLive;
  if (partDelta > 5) return "arrow.down";
  if (partDelta < -5) return "arrow.up";
  console.log({ partDelta });
  return "";
}

/**
 * Constructs an SFSymbol from the given symbolName
 *
 * @param {string} symbolName
 * @param {number} fontSize
 * @returns {object} SFSymbol
 */
function createSymbol(symbolName, fontSize) {
  const symbol = SFSymbol.named(symbolName);
  symbol.applyFont(Font.systemFont(fontSize));
  return symbol;
}

async function run() {
  const listWidget = new ListWidget();
  listWidget.useDefaultPadding();

  try {
     const sensorId = await getSensorId();

    if (!sensorId) {
      throw "Please specify a location for this widget.";
    }
    console.log(`Using sensor ID: ${sensorId}`);

    const data = await getSensorData(sensorId);

    const stats = JSON.parse(data.val);
    console.log({ stats });

    const aqiTrend = getAQITrend(stats);

    const epaPM = computePM(data);
    console.log({ epaPM });

    const aqi = aqiFromPM(epaPM);
    const level = calculateLevel(aqi);
    const aqiText = aqi.toString();
    console.log({ aqi });

    const sensorLocation = await getLocation(data)
    console.log({ sensorLocation });

    const startColor = Color.dynamic(new Color(level.startColor), new Color(level.darkStartColor));
    const endColor = Color.dynamic(new Color(level.endColor), new Color(level.darkEndColor));
    const textColor = Color.dynamic(new Color(level.textColor), new Color(level.darkTextColor));

    // BACKGROUND

    const gradient = new LinearGradient();
    gradient.colors = [startColor, endColor];
    gradient.locations = [0.0, 1];
    console.log({ gradient });

    listWidget.backgroundGradient = gradient;

    // HEADER

    const headStack = listWidget.addStack();
    headStack.layoutHorizontally();
    headStack.topAlignContent();
    headStack.setPadding (0,0,0,0);

    const textStack = headStack.addStack();
    textStack.layoutVertically();
    textStack.topAlignContent();
    textStack.setPadding (0,0,0,0);

    const header = textStack.addText('Air Quality'.toUpperCase());
    header.textColor = textColor;
    header.font = Font.regularSystemFont(12);
    header.minimumScaleFactor = 1;

	const text = textStack.addText('');
    header.textColor = textColor;
    header.font = Font.regularSystemFont(12);
    header.minimumScaleFactor = 1;

    const wordLevel = textStack.addText(level.label);
    wordLevel.textColor = textColor;
    wordLevel.font = Font.heavySystemFont(18);
    wordLevel.minimumScaleFactor = 1;    

    headStack.addSpacer();

    const statusSymbol = createSymbol(level.sfSymbol, 30);
    const statusImg = headStack.addImage(statusSymbol.image);
    statusImg.resizable = false;
    statusImg.tintColor = textColor;

    listWidget.addSpacer(0);
	
	
    // SCORE

    const scoreStack = listWidget.addStack();
    scoreStack.centerAlignContent()

    const content = scoreStack.addText(aqiText + ' μg/m³');
    content.textColor = textColor;
    content.font = Font.boldSystemFont(26);
    content.minimumScaleFactor = 0.5;
    
	const updatedAt = new Date(data.ts * 1000).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });

    if (aqiTrend.length > 0) {
      scoreStack.addSpacer(4);

      const trendSymbol = createSymbol(aqiTrend, 15);
      const trendImg = scoreStack.addImage(trendSymbol.image);
      trendImg.resizable = false;
      trendImg.tintColor = textColor;
    }
    
    console.log("aqiText = " + aqiText)
    
    if (aqiText > args.widgetParameter) {
        console.log("High AQI warning notification")
        let n2 = new Notification()
		n2.title = "AQI Alert for your area"
		n2.subtitle = "The air in your area is " + level.label.toLowerCase() + " (" + aqiText + "μg/m³ – " + updatedAt + ")."
		n2.body = "Swipe this notification down for more options and to read the entire notification. If you think you are in danger, close your windows, shut down all ventilation without filters and watch your local news for further information."
		n2.addAction("Refresh", "scriptable:///run/AQI%20(Air%20Quality%20Index)", false)
		n2.addAction("More information", `https://www.purpleair.com/map?opt=1/i/mAQI/a10/cC5&select=${sensorId}#14/${data.lat}/${data.lon}`, false)
		n2.addAction("News", "https://news.google.com/topstories?hl=en-US&gl=US&ceid=US:en", false)
		n2.addAction("Customize/Disable Alert", "https://github.com/Dylan-Wettstein/AQI-widget/blob/main/how_to_CUSTOMIZE_or_DISABLE_HIGH_AQI_WARNING.md", true)
		n2.addAction("Call ambulance", "https://en.wikipedia.org/wiki/List_of_emergency_telephone_numbers?wprov=sfti1", true)
		n2.openURL = "scriptable:///run/AQI%20(Air%20Quality%20Index)"
		n2.sound = "alarm"
		n2.schedule()
	}

    listWidget.addSpacer();

    // LOCATION

    const locationText = listWidget.addText(sensorLocation.toUpperCase() + ' (' + updatedAt + ')');
    locationText.textColor = textColor;
    locationText.font = Font.regularSystemFont(8);
    locationText.minimumScaleFactor = 0.5;

    listWidget.addSpacer(2);

    // UPDATED AT

//     const widgetText = listWidget.addText(`TIME OF MEASUREMENT: ${updatedAt}`);
//     widgetText.textColor = textColor;
//     widgetText.font = Font.regularSystemFont(8);
//     widgetText.minimumScaleFactor = 0.5;

    // TAP HANDLER

    const purpleMapUrl = `scriptable:///run/AQI%20(Air%20Quality%20Index)`;
    listWidget.url = purpleMapUrl;
  } catch (error) {
    if (error === 666) {
      // Handle JSON parsing errors with a custom error layout

      listWidget.background = new Color('999999');
      const header = listWidget.addText('ERROR. Please try to reboot your device.');
      header.textColor = new Color('000000');
      header.font = Font.regularSystemFont(11);
      header.minimumScaleFactor = 0.50;

      listWidget.addSpacer(15);

      const wordLevel = listWidget.addText(`Couldn't connect to the server.`);
      wordLevel.textColor = new Color ('000000');
      wordLevel.font = Font.semiboldSystemFont(15);
      wordLevel.minimumScaleFactor = 0.3;
    } else {
      console.log(`Could not render widget: ${error}`);

      const errorWidgetText = listWidget.addText(`${error}`);
      errorWidgetText.textColor = Color.red();
      errorWidgetText.textOpacity = 30;
      errorWidgetText.font = Font.regularSystemFont(10);
    }
  }



    let url = "https://dylanwettstein.com/projects/aqi-air-quality-index"
let r = new Request(url)
let body = await r.loadString()
if (config.runsInApp) {  

	let needles = ["<p>Aktuelle Version: " + version]
	let foundNeedles = needles.filter(n => {
    return body.includes(n)
  })
  if (foundNeedles.length > 0) {
    console.log("Update Check: Version UP TO DATE")
    var updateAvailable = "no"

      if (config.runsInApp) {
    
    App.close()
    
   function logBar()
{

 	console.log("stop")

	Notification.removeAllDelivered()

}

	console.log("start")
	let tm = new Timer()
	tm.timeInterval = 5000
	tm.schedule(logBar)
 
    let n = new Notification()
		n.title = "Information refreshed successfully"
		n.subtitle = "Your widget will display the newest measurement in a few seconds."
		n.body = "If you are experiencing issues with this script or the widget, feel free to contact me by swiping down this notification."
		n.addAction("Refresh again", "scriptable:///run/AQI%20(Air%20Quality%20Index)", false)
		n.addAction("Contact", "mailto:contact@dylanwettstein.com?subject=AQI%20widget&body=Hi%2C%0D%0AI%20need%20help%20with%20the%20AQI%20widget%E2%80%A6", true)
		n.openURL = "scriptable:///run/AQI%20(Air%20Quality%20Index)"
		n.schedule() 
		
    
    
  }
  } else {
    console.log("Update Check: Version OUT OF DATE")
    var updateAvailable = "yes"
    let n3 = new Notification()
		n3.title = "Update available"
		n3.subtitle = "Great news! An update for this script is available!"
		n3.body = "To open the update site, tap this notification. You'll get this notification every time your widget refreshes until you update the script."
		n3.addAction("Update now", "https://dylanwettstein.com/projects/aqi-air-quality-index", false)
		n3.openURL = "https://dylanwettstein.com/projects/aqi-air-quality-index"
		n3.schedule()

  }
}

Script.setWidget(listWidget);

Script.complete()

}

await run();
