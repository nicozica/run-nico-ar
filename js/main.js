// Main JavaScript for Workout Plans Site
// Optimized and consolidated scripts

// Weather functionality
function getWeatherIcon(weatherDesc, temp) {
    const desc = weatherDesc.toLowerCase();
    
    if (desc.includes('rain') || desc.includes('drizzle') || desc.includes('shower')) {
        return '<i class="fas fa-cloud-rain"></i>';
    } else if (desc.includes('snow') || desc.includes('sleet')) {
        return '<i class="fas fa-snowflake"></i>';
    } else if (desc.includes('storm') || desc.includes('thunder')) {
        return '<i class="fas fa-bolt"></i>';
    } else if (desc.includes('fog') || desc.includes('mist') || desc.includes('haze')) {
        return '<i class="fas fa-smog"></i>';
    } else if (desc.includes('cloud') || desc.includes('overcast')) {
        return '<i class="fas fa-cloud"></i>';
    } else if (desc.includes('partly') || desc.includes('scattered')) {
        return '<i class="fas fa-cloud-sun"></i>';
    } else if (desc.includes('clear') || desc.includes('sunny')) {
        return '<i class="fas fa-sun"></i>';
    } else {
        // Default based on temperature
        return temp > 25 ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-cloud"></i>';
    }
}

function updateWeatherData() {
    console.log('Updating weather data...');
    
    // Try a simpler approach first
    const weatherUrl = 'https://wttr.in/Buenos%20Aires?format=j1';
    
    fetch(weatherUrl)
    .then(response => {
        console.log('Weather response received:', response.status, response.ok);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        console.log('Weather data received:', data);
        
        // Check if data structure is correct
        if (!data.current_condition || !data.current_condition[0]) {
            throw new Error('Invalid weather data structure');
        }
        
        // Current conditions
        const current = data.current_condition[0];
        
        // Get weather description and icon
        const weatherDesc = current.weatherDesc[0].value;
        const weatherIcon = getWeatherIcon(weatherDesc, parseInt(current.temp_C));
        
        // Update all weather elements
        const tempElement = document.getElementById('weather-temp');
        const distanceElement = document.getElementById('weather-distance');
        const windElement = document.getElementById('weather-wind');
        const humidityElement = document.getElementById('weather-humidity');
        const feelsElement = document.getElementById('weather-feels');
        
        console.log('Updating elements...');
        
        if (tempElement) {
            tempElement.innerHTML = `${weatherIcon} ${current.temp_C}°C`;
            console.log('Temperature updated');
        }
        if (distanceElement) {
            distanceElement.textContent = `${current.visibility} km`;
            console.log('Visibility updated');
        }
        if (windElement) {
            windElement.textContent = `${current.windspeedKmph} km/h`;
            console.log('Wind updated');
        }
        if (humidityElement) {
            humidityElement.textContent = `${current.humidity}%`;
            console.log('Humidity updated');
        }
        if (feelsElement) {
            feelsElement.textContent = `${current.FeelsLikeC}°C`;
            console.log('Feels like updated');
        }
        
        console.log(`Weather updated successfully: ${weatherDesc}, ${current.temp_C}°C`);
    })
    .catch(error => {
        console.error('Weather fetch failed:', error);
        
        // Try alternative approach
        console.log('Trying fallback weather update...');
        
        // Set more informative fallback values
        const tempElement = document.getElementById('weather-temp');
        const distanceElement = document.getElementById('weather-distance');
        const windElement = document.getElementById('weather-wind');
        const humidityElement = document.getElementById('weather-humidity');
        const feelsElement = document.getElementById('weather-feels');
        
        if (tempElement) tempElement.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Unavailable';
        if (distanceElement) distanceElement.textContent = 'N/A';
        if (windElement) windElement.textContent = 'N/A';
        if (humidityElement) humidityElement.textContent = 'N/A';
        if (feelsElement) feelsElement.textContent = 'N/A';
        
        // Try again in 5 seconds
        setTimeout(() => {
            console.log('Retrying weather fetch...');
            simpleWeatherFetch();
        }, 5000);
    });
}

// Simplified weather fetch as backup
function simpleWeatherFetch() {
    fetch('https://wttr.in/Buenos%20Aires?format=%C+%t+%h+%w+%v')
    .then(response => response.text())
    .then(data => {
        console.log('Simple weather data:', data);
        const parts = data.split(' ');
        
        const tempElement = document.getElementById('weather-temp');
        if (tempElement && parts[1]) {
            tempElement.innerHTML = `<i class="fas fa-cloud"></i> ${parts[1]}`;
        }
    })
    .catch(error => {
        console.error('Simple weather fetch failed:', error);
    });
}

// Initialize everything when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing...');
    
    // Start page animations
    const sessions = document.querySelectorAll('.session');
    sessions.forEach((session, index) => {
        session.style.opacity = '0';
        session.style.transform = 'translateY(20px)';
        setTimeout(() => {
            session.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
            session.style.opacity = '1';
            session.style.transform = 'translateY(0)';
        }, index * 200);
    });
    
    // Update weather immediately
    updateWeatherData();
    
    // Optional: Update weather every 10 minutes for long-running pages
    setInterval(updateWeatherData, 600000); // 10 minutes
});

// Force weather update on page focus (when user returns to tab)
window.addEventListener('focus', function() {
    updateWeatherData();
});
