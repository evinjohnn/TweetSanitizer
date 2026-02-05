// Country name to flag emoji mapping
const COUNTRY_FLAGS = {
  // Continents & Regions
  "Africa": "Africa",
  "Antarctica": "Antarctica",
  "Asia": "Asia",
  "Europe": "Europe",
  "North America": "North America",
  "South America": "South America",
  "Oceania": "Oceania",
  "South Asia": "South Asia",
  "Southeast Asia": "Southeast Asia",
  "Middle East": "Middle East",
  "West Asia": "West Asia",
  "East Asia": "East Asia",
  "Central Asia": "Central Asia",
  "North Asia": "North Asia",
  "Western Europe": "Western Europe",
  "Eastern Europe": "Eastern Europe",
  "Northern Europe": "Northern Europe",
  "Southern Europe": "Southern Europe",
  "Central Europe": "Central Europe",
  "Caribbean": "Caribbean",
  "European Union": "🇪🇺",
  "World": "World",
  "Global": "Global",
  "International": "International",

  // Countries A-Z
  "Afghanistan": "🇦🇫",
  "Albania": "🇦🇱",
  "Algeria": "🇩🇿",
  "American Samoa": "🇦🇸",
  "Andorra": "🇦🇩",
  "Angola": "🇦🇴",
  "Anguilla": "🇦🇮",
  "Antigua and Barbuda": "🇦🇬",
  "Argentina": "🇦🇷",
  "Armenia": "🇦🇲",
  "Aruba": "🇦🇼",
  "Australia": "🇦🇺",
  "Austria": "🇦🇹",
  "Azerbaijan": "🇦🇿",
  "Bahamas": "🇧🇸",
  "Bahrain": "🇧🇭",
  "Bangladesh": "🇧🇩",
  "Barbados": "🇧🇧",
  "Belarus": "🇧🇾",
  "Belgium": "🇧🇪",
  "Belize": "🇧🇿",
  "Benin": "🇧🇯",
  "Bermuda": "🇧🇲",
  "Bhutan": "🇧🇹",
  "Bolivia": "🇧🇴",
  "Bosnia and Herzegovina": "🇧🇦",
  "Botswana": "🇧🇼",
  "Brazil": "🇧🇷",
  "British Indian Ocean Territory": "🇮🇴",
  "Brunei": "🇧🇳",
  "Bulgaria": "🇧🇬",
  "Burkina Faso": "🇧🇫",
  "Burundi": "🇧🇮",
  "Cambodia": "🇰🇭",
  "Cameroon": "🇨🇲",
  "Canada": "🇨🇦",
  "Cape Verde": "🇨🇻",
  "Cayman Islands": "🇰🇾",
  "Central African Republic": "🇨🇫",
  "Chad": "🇹🇩",
  "Chile": "🇨🇱",
  "China": "🇨🇳",
  "Christmas Island": "🇨🇽",
  "Colombia": "🇨🇴",
  "Comoros": "🇰🇲",
  "Congo": "🇨🇬",
  "Democratic Republic of the Congo": "🇨🇩",
  "Cook Islands": "🇨🇰",
  "Costa Rica": "🇨🇷",
  "Croatia": "🇭🇷",
  "Cuba": "🇨🇺",
  "Curaçao": "🇨🇼",
  "Cyprus": "🇨🇾",
  "Czech Republic": "🇨🇿",
  "Czechia": "🇨🇿",
  "Denmark": "🇩🇰",
  "Djibouti": "🇩🇯",
  "Dominica": "🇩🇲",
  "Dominican Republic": "🇩🇴",
  "Ecuador": "🇪🇨",
  "Egypt": "🇪🇬",
  "El Salvador": "🇸🇻",
  "Equatorial Guinea": "🇬🇶",
  "Eritrea": "🇪🇷",
  "Estonia": "🇪🇪",
  "Eswatini": "🇸🇿",
  "Ethiopia": "🇪🇹",
  "Falkland Islands": "🇫🇰",
  "Faroe Islands": "🇫🇴",
  "Fiji": "🇫🇯",
  "Finland": "🇫🇮",
  "France": "🇫🇷",
  "French Guiana": "🇬🇫",
  "French Polynesia": "🇵🇫",
  "Gabon": "🇬🇦",
  "Gambia": "🇬🇲",
  "Georgia": "🇬🇪",
  "Germany": "🇩🇪",
  "Ghana": "🇬🇭",
  "Gibraltar": "🇬🇮",
  "Greece": "🇬🇷",
  "Greenland": "🇬🇱",
  "Grenada": "🇬🇩",
  "Guadeloupe": "🇬🇵",
  "Guam": "🇬🇺",
  "Guatemala": "🇬🇹",
  "Guernsey": "🇬🇬",
  "Guinea": "🇬🇳",
  "Guinea-Bissau": "🇬🇼",
  "Guyana": "🇬🇾",
  "Haiti": "🇭🇹",
  "Honduras": "🇭🇳",
  "Hong Kong": "🇭🇰",
  "Hungary": "🇭🇺",
  "Iceland": "🇮🇸",
  "India": "🇮🇳",
  "Indonesia": "🇮🇩",
  "Iran": "🇮🇷",
  "Iraq": "🇮🇶",
  "Ireland": "🇮🇪",
  "Isle of Man": "🇮🇲",
  "Israel": "🇮🇱",
  "Italy": "🇮🇹",
  "Ivory Coast": "🇨🇮",
  "Jamaica": "🇯🇲",
  "Japan": "🇯🇵",
  "Jersey": "🇯🇪",
  "Jordan": "🇯🇴",
  "Kazakhstan": "🇰🇿",
  "Kenya": "🇰🇪",
  "Kiribati": "🇰🇮",
  "Kosovo": "🇽🇰",
  "Kuwait": "🇰🇼",
  "Kyrgyzstan": "🇰🇬",
  "Laos": "🇱🇦",
  "Latvia": "🇱🇻",
  "Lebanon": "🇱🇧",
  "Lesotho": "🇱🇸",
  "Liberia": "🇱🇷",
  "Libya": "🇱🇾",
  "Liechtenstein": "🇱🇮",
  "Lithuania": "🇱🇹",
  "Luxembourg": "🇱🇺",
  "Macau": "🇲🇴",
  "Madagascar": "🇲🇬",
  "Malawi": "🇲🇼",
  "Malaysia": "🇲🇾",
  "Maldives": "🇲🇻",
  "Mali": "🇲🇱",
  "Malta": "🇲🇹",
  "Marshall Islands": "🇲🇭",
  "Martinique": "🇲🇶",
  "Mauritania": "🇲🇷",
  "Mauritius": "🇲🇺",
  "Mayotte": "🇾🇹",
  "Mexico": "🇲🇽",
  "Micronesia": "🇫🇲",
  "Moldova": "🇲🇩",
  "Monaco": "🇲🇨",
  "Mongolia": "🇲🇳",
  "Montenegro": "🇲🇪",
  "Montserrat": "🇲🇸",
  "Morocco": "🇲🇦",
  "Mozambique": "🇲🇿",
  "Myanmar": "🇲🇲",
  "Namibia": "🇳🇦",
  "Nauru": "🇳🇷",
  "Nepal": "🇳🇵",
  "Netherlands": "🇳🇱",
  "New Caledonia": "🇳🇨",
  "New Zealand": "🇳🇿",
  "Nicaragua": "🇳🇮",
  "Niger": "🇳🇪",
  "Nigeria": "🇳🇬",
  "Niue": "🇳🇺",
  "North Korea": "🇰🇵",
  "North Macedonia": "🇲🇰",
  "Northern Mariana Islands": "🇲🇵",
  "Norway": "🇳🇴",
  "Oman": "🇴🇲",
  "Pakistan": "🇵🇰",
  "Palau": "🇵🇼",
  "Palestine": "🇵🇸",
  "Panama": "🇵🇦",
  "Papua New Guinea": "🇵🇬",
  "Paraguay": "🇵🇾",
  "Peru": "🇵🇪",
  "Philippines": "🇵🇭",
  "Poland": "🇵🇱",
  "Portugal": "🇵🇹",
  "Puerto Rico": "🇵🇷",
  "Qatar": "🇶🇦",
  "Réunion": "🇷🇪",
  "Romania": "🇷🇴",
  "Russia": "🇷🇺",
  "Rwanda": "🇷🇼",
  "Saint Barthélemy": "🇧🇱",
  "Saint Kitts and Nevis": "🇰🇳",
  "Saint Lucia": "🇱🇨",
  "Saint Martin": "🇲🇫",
  "Saint Pierre and Miquelon": "🇵🇲",
  "Saint Vincent and the Grenadines": "🇻🇨",
  "Samoa": "🇼🇸",
  "San Marino": "🇸🇲",
  "Sao Tome and Principe": "🇸🇹",
  "Saudi Arabia": "🇸🇦",
  "Senegal": "🇸🇳",
  "Serbia": "🇷🇸",
  "Seychelles": "🇸🇨",
  "Sierra Leone": "🇸🇱",
  "Singapore": "🇸🇬",
  "Sint Maarten": "🇸🇽",
  "Slovakia": "🇸🇰",
  "Slovenia": "🇸🇮",
  "Solomon Islands": "🇸🇧",
  "Somalia": "🇸🇴",
  "South Africa": "🇿🇦",
  "South Korea": "🇰🇷",
  "Korea": "🇰🇷",
  "South Sudan": "🇸🇸",
  "Spain": "🇪🇸",
  "Sri Lanka": "🇱🇰",
  "Sudan": "🇸🇩",
  "Suriname": "🇸🇷",
  "Sweden": "🇸🇪",
  "Switzerland": "🇨🇭",
  "Syria": "🇸🇾",
  "Taiwan": "🇹🇼",
  "Tajikistan": "🇹🇯",
  "Tanzania": "🇹🇿",
  "Thailand": "🇹🇭",
  "Timor-Leste": "🇹🇱",
  "Togo": "🇹🇬",
  "Tokelau": "🇹🇰",
  "Tonga": "🇹🇴",
  "Trinidad and Tobago": "🇹🇹",
  "Tunisia": "🇹🇳",
  "Turkey": "🇹🇷",
  "Turkmenistan": "🇹🇲",
  "Turks and Caicos Islands": "🇹🇨",
  "Tuvalu": "🇹🇻",
  "Uganda": "🇺🇬",
  "Ukraine": "🇺🇦",
  "United Arab Emirates": "🇦🇪",
  "UAE": "🇦🇪",
  "United Kingdom": "🇬🇧",
  "UK": "🇬🇧",
  "United States": "🇺🇸",
  "USA": "🇺🇸",
  "US": "🇺🇸",
  "Uruguay": "🇺🇾",
  "Uzbekistan": "🇺🇿",
  "Vanuatu": "🇻🇺",
  "Vatican City": "🇻🇦",
  "Venezuela": "🇻🇪",
  "Vietnam": "🇻🇳",
  "Virgin Islands, British": "🇻🇬",
  "Virgin Islands, U.S.": "🇻🇮",
  "Wallis and Futuna": "🇼🇫",
  "Western Sahara": "🇪🇭",
  "Yemen": "🇾🇪",
  "Zambia": "🇿🇲",
  "Zimbabwe": "🇿🇼"
};

// Region styling configuration
const REGION_STYLES = {
  // Main Continents
  "Africa": {
    backgroundColor: "#FFD700", // Gold
    color: "#000000",
    label: "Africa"
  },
  "Antarctica": {
    backgroundColor: "#FFFFFF", // White
    color: "#000000",
    border: "1px solid #E1E8ED", // Light border for visibility
    label: "Antarctica"
  },
  "Asia": {
    backgroundColor: "#F1C40F", // Yellow (slightly darker for readability)
    color: "#000000",
    label: "Asia"
  },
  "Australia": {
    background: "linear-gradient(to right, #2ECC71, #FFD700)", // Green & Gold
    color: "#FFFFFF",
    textShadow: "0px 1px 2px rgba(0,0,0,0.5)", // Shadow for text readability on gradient
    label: "Australia"
  },
  "Oceania": {
    background: "linear-gradient(to right, #2ECC71, #FFD700)", // Same as Australia
    color: "#FFFFFF",
    textShadow: "0px 1px 2px rgba(0,0,0,0.5)",
    label: "Oceania"
  },
  "Europe": {
    backgroundColor: "#3498DB", // Blue
    color: "#FFFFFF",
    label: "Europe"
  },
  "North America": {
    backgroundColor: "#E74C3C", // Red
    color: "#FFFFFF",
    label: "North America"
  },
  "South America": {
    backgroundColor: "#2ECC71", // Green
    color: "#FFFFFF",
    label: "South America"
  },

  // Asian Sub-regions
  "South Asia": {
    backgroundColor: "#F1C40F", // Yellow (Asia)
    color: "#000000",
    label: "South Asia"
  },
  "Southeast Asia": {
    backgroundColor: "#F1C40F", // Yellow (Asia)
    color: "#000000",
    label: "Southeast Asia"
  },
  "East Asia": {
    backgroundColor: "#F1C40F", // Yellow (Asia)
    color: "#000000",
    label: "East Asia"
  },
  "West Asia": {
    backgroundColor: "#FFD700", // Gold (overlaps with Middle East)
    color: "#000000",
    label: "West Asia"
  },
  "Central Asia": {
    backgroundColor: "#F1C40F", // Yellow (Asia)
    color: "#000000",
    label: "Central Asia"
  },
  "North Asia": {
    backgroundColor: "#F1C40F", // Yellow (Asia)
    color: "#000000",
    label: "North Asia"
  },

  // Middle East
  "Middle East": {
    backgroundColor: "#FFD700", // Gold (Africa/Asia bridge)
    color: "#000000",
    label: "Middle East"
  },

  // European Sub-regions
  "Western Europe": {
    backgroundColor: "#3498DB", // Blue (Europe)
    color: "#FFFFFF",
    label: "W. Europe"
  },
  "Eastern Europe": {
    backgroundColor: "#3498DB", // Blue (Europe)
    color: "#FFFFFF",
    label: "E. Europe"
  },
  "Northern Europe": {
    backgroundColor: "#3498DB", // Blue (Europe)
    color: "#FFFFFF",
    label: "N. Europe"
  },
  "Southern Europe": {
    backgroundColor: "#3498DB", // Blue (Europe)
    color: "#FFFFFF",
    label: "S. Europe"
  },
  "Central Europe": {
    backgroundColor: "#3498DB", // Blue (Europe)
    color: "#FFFFFF",
    label: "C. Europe"
  },

  // African Sub-regions
  "North Africa": {
    backgroundColor: "#FFD700", // Gold (Africa)
    color: "#000000",
    label: "N. Africa"
  },
  "South Africa": {
    backgroundColor: "#FFD700", // Gold (Africa) - Note: Also a country
    color: "#000000",
    label: "S. Africa"
  },
  "East Africa": {
    backgroundColor: "#FFD700", // Gold (Africa)
    color: "#000000",
    label: "E. Africa"
  },
  "West Africa": {
    backgroundColor: "#FFD700", // Gold (Africa)
    color: "#000000",
    label: "W. Africa"
  },
  "Central Africa": {
    backgroundColor: "#FFD700", // Gold (Africa)
    color: "#000000",
    label: "C. Africa"
  },

  // American Sub-regions
  "Central America": {
    backgroundColor: "#E74C3C", // Red (North America region)
    color: "#FFFFFF",
    label: "C. America"
  },
  "Caribbean": {
    backgroundColor: "#E74C3C", // Red (North America region)
    color: "#FFFFFF",
    label: "Caribbean"
  },
  "Latin America": {
    backgroundColor: "#2ECC71", // Green (South America)
    color: "#FFFFFF",
    label: "Latin America"
  },

  // Global/World
  "World": {
    backgroundColor: "#34495E", // Dark Blue/Grey
    color: "#FFFFFF",
    label: "World"
  },
  "Global": {
    backgroundColor: "#34495E",
    color: "#FFFFFF",
    label: "Global"
  },
  "International": {
    backgroundColor: "#34495E",
    color: "#FFFFFF",
    label: "International"
  }
};

function getCountryFlag(countryName) {
  if (!countryName) return null;

  let match = null;
  let normalized = countryName.trim();

  // Try exact match first
  if (COUNTRY_FLAGS[normalized]) {
    match = normalized;
  } else {
    // Try case-insensitive match
    for (const country of Object.keys(COUNTRY_FLAGS)) {
      if (country.toLowerCase() === normalized.toLowerCase()) {
        match = country;
        break;
      }
    }
  }

  // Try partial match for some common cases
  if (!match) {
    const lowerName = normalized.toLowerCase();
    if (lowerName.includes('united states') || lowerName.includes('america')) match = 'United States';
    else if (lowerName.includes('united kingdom') || lowerName.includes('britain')) match = 'United Kingdom';
    else if (lowerName.includes('korea') && lowerName.includes('south')) match = 'South Korea';
    else if (lowerName.includes('russia')) match = 'Russia';
    else if (lowerName.includes('china')) match = 'China';

    // Region aliases
    else if (lowerName === 'west europe') match = 'Western Europe';
    else if (lowerName === 'east europe') match = 'Eastern Europe';
    else if (lowerName === 'north europe') match = 'Northern Europe';
    else if (lowerName === 'south europe') match = 'Southern Europe';
    else if (lowerName === 'west asia') match = 'West Asia'; // Already exists but good to be explicit if needed
    else if (lowerName === 'viet nam') match = 'Vietnam';
    else if (lowerName === 'turkiye') match = 'Turkey';
    else if (lowerName === "cote d'ivoire") match = 'Ivory Coast';
    else if (lowerName === 'timor leste' || lowerName === 'east timor') match = 'Timor-Leste';
    else if (lowerName === 'burma') match = 'Myanmar';
    else if (lowerName === 'macao') match = 'Macau';
    else if (lowerName === 'hongkong') match = 'Hong Kong';
    else if (lowerName === 'swaziland') match = 'Eswatini';

    // Handle "St." prefix
    else if (lowerName.startsWith('st. ')) {
      const expanded = lowerName.replace('st. ', 'saint ');
      // Try to match the expanded name
      for (const country of Object.keys(COUNTRY_FLAGS)) {
        if (country.toLowerCase() === expanded) {
          match = country;
          break;
        }
      }
    }
  }

  if (match) {
    // Check if it's a region with special styling
    if (REGION_STYLES[match]) {
      return {
        type: 'text',
        value: REGION_STYLES[match].label,
        key: match, // Added normalized key for blocking
        style: REGION_STYLES[match]
      };
    }
    // Default to emoji for countries
    return {
      type: 'emoji',
      value: COUNTRY_FLAGS[match],
      key: match // Added normalized key for blocking
    };
  }

  return null;
}

// Expose to window for content.js access (Webpack workaround)
if (typeof window !== 'undefined') {
  window.getCountryFlag = getCountryFlag;
  window.REGION_STYLES = REGION_STYLES;
  window.COUNTRY_FLAGS = COUNTRY_FLAGS;
}
