import Hls from "hls.js";
import Chart from 'chart.js/auto';


const video = document.getElementById("video");
const segmentUrlSpan = document.getElementById('segment-url');
const segmentDurationSpan = document.getElementById('segment-duration');
const bufferFill = document.getElementById('buffer-fill');
const bufferPercentage = document.getElementById('buffer-percentage');
const bitrateSpan = document.getElementById('bitrate');
const qualitySelect = document.getElementById('quality-select');

// Initialize chart variable
let loadTimeChart = null;
let segmentCounter = 0;
let isQualityChanging = false;
let qualityChangeTimeout = null;
let pendingSegments = [];

if (Hls.isSupported()) {
  const hls = new Hls();
  hls.loadSource('https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8');
  hls.attachMedia(video);

  // Add error handling
  hls.on(Hls.Events.ERROR, function (event, data) {
    if (data.fatal) {
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          hls.startLoad();
          break;
        case Hls.ErrorTypes.MEDIA_ERROR:
          hls.recoverMediaError();
          break;
        default:
          hls.destroy();
          break;
      }
    }
  });

  // Initialize Chart.js after DOM is ready
  function initializeChart() {
    const chartCanvas = document.getElementById('loadTimeChart');
    if (chartCanvas && !loadTimeChart) {
      const ctx = chartCanvas.getContext('2d');
      const isDark = document.documentElement.classList.contains('dark');
      const textColor = isDark ? '#E5E7EB' : '#374151';
      const gridColor = isDark ? 'rgba(75, 85, 99, 0.3)' : 'rgba(0, 0, 0, 0.1)';
      
      loadTimeChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Load Time (ms)',
            data: [],
            borderColor: '#3B82F6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            tension: 0.3,
            pointRadius: 3,
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            intersect: false,
          },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: {
                color: textColor
              }
            }
          },
          scales: {
            x: {
              title: { 
                display: true, 
                text: 'Segment #', 
                font: { weight: 'bold' },
                color: textColor
              },
              ticks: {
                color: textColor
              },
              grid: {
                display: true,
                color: gridColor
              }
            },
            y: {
              title: { 
                display: true, 
                text: 'Load Time (ms)', 
                font: { weight: 'bold' },
                color: textColor
              },
              ticks: {
                color: textColor
              },
              beginAtZero: true,
              grid: {
                display: true,
                color: gridColor
              }
            }
          },
          animation: {
            duration: 300
          }
        }
      });
    }
  }

  // Initialize chart when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initializeDarkMode();
      initializeChart();
    });
  } else {
    initializeDarkMode();
    initializeChart();
  }


  hls.on(Hls.Events.MANIFEST_PARSED, function () {
    qualitySelect.innerHTML = ''; // önceki verileri temizle

    const autoOption = document.createElement('option');
    autoOption.value = "-1";
    autoOption.textContent = "Auto";
    qualitySelect.appendChild(autoOption);

    hls.levels.forEach((level, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = `${level.height}p (${(level.bitrate / 1000).toFixed(0)} kbps)`;
      qualitySelect.appendChild(option);
    });

    qualitySelect.value = hls.currentLevel;
  });

  qualitySelect.addEventListener('change', function () {
    const selectedLevel = parseInt(this.value, 10);
    
    // Set quality changing flag to prevent chart updates during transition
    isQualityChanging = true;
    
    // Clear any existing timeout
    if (qualityChangeTimeout) {
      clearTimeout(qualityChangeTimeout);
    }
    
    // Clear pending segments array to start fresh
    pendingSegments = [];
    
    // Set the new quality level
    hls.currentLevel = selectedLevel;
    
    // Reset the flag after a delay to allow transition to complete
    qualityChangeTimeout = setTimeout(() => {
      isQualityChanging = false;
      
      // Process any pending segments that were queued during the transition
      if (pendingSegments.length > 0 && loadTimeChart && loadTimeChart.data) {
        const chartData = loadTimeChart.data;
        
        pendingSegments.forEach(segment => {
          segmentCounter++;
          chartData.labels.push(segmentCounter);
          chartData.datasets[0].data.push(segment.loadTime);
        });
        
        // Keep only the last 30 data points (sliding window)
        while (chartData.labels.length > 30) {
          chartData.labels.shift();
          chartData.datasets[0].data.shift();
        }
        
        // Update chart with all pending data at once
        loadTimeChart.update('active');
        
        // Clear the pending segments
        pendingSegments = [];
      }
    }, 2000); // 2 second delay to allow quality change to stabilize
  });

  // Fragment loaded event to track segment load times
  hls.on(Hls.Events.FRAG_LOADED, function (event, data) {
    const frag = data.frag;
    const url = frag.url || (frag.baseurl + frag.relurl);

    // Process only video segments
    if (url && url.includes("video")) {
      // Extract just the filename for cleaner display
      const filename = url.split('/').pop();
      segmentUrlSpan.textContent = filename || url;

      // Get timing data from fragment stats
      const stats = frag._stats;
      if (stats && stats.loading) {
        const loadTime = stats.loading.end - stats.loading.start;
        segmentDurationSpan.textContent = loadTime.toFixed(2) + " ms";

        // Update chart only if it's initialized and not during quality change
        if (loadTimeChart && loadTimeChart.data && !isQualityChanging) {
          segmentCounter++;
          const chartData = loadTimeChart.data;
          chartData.labels.push(segmentCounter);
          chartData.datasets[0].data.push(loadTime);

          // Keep only the last 30 data points (sliding window)
          if (chartData.labels.length > 30) {
            chartData.labels.shift();
            chartData.datasets[0].data.shift();
          }

          // Update chart with animation
          loadTimeChart.update('active');
        } else if (isQualityChanging) {
          // Queue segments during quality change instead of dropping them
          pendingSegments.push({ loadTime: loadTime });
        }
      } else {
        segmentDurationSpan.textContent = "N/A";
      }
    }

    updateBufferProgress();
  });

  // Update buffer progress on timeupdate
  video.addEventListener('timeupdate', updateBufferProgress);
  video.addEventListener('progress', updateBufferProgress);

  function updateBufferProgress() {
    if (video && video.buffered.length > 0) {
      const bufferedEnd = video.buffered.end(video.buffered.length - 1);
      const currentTime = video.currentTime;
      const duration = video.duration;

      if (!isNaN(duration) && duration > 0) {
        const bufferedFraction = Math.min(bufferedEnd / duration, 1);
        const percentage = Math.round(bufferedFraction * 100);

        bufferFill.style.width = percentage + '%';
        bufferPercentage.textContent = percentage + '%';
      }
    }
  }


  // Update bitrate display on level switch
  hls.on(Hls.Events.LEVEL_SWITCHED, function (event, data) {
    const level = hls.levels[data.level];
    if (level && level.bitrate) {
      const bitrateKbps = (level.bitrate / 1000).toFixed(0); // kbps
      bitrateSpan.textContent = `${bitrateKbps} kbps`;
    } else {
      bitrateSpan.textContent = "Auto";
    }
  });
} else if (video.canPlayType('application/vnd.apple.mpegurl')) {
  // Safari native HLS support
  video.src = 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8';
  
  // Initialize chart for Safari
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initializeDarkMode();
      initializeChart();
    });
  } else {
    initializeDarkMode();
    initializeChart();
  }
} else {
  console.error('HLS is not supported in this browser');
  // Show error message to user
  const video = document.getElementById('video');
  if (video) {
    video.outerHTML = `
      <div class="w-full max-w-4xl mx-auto rounded-lg shadow-md bg-red-50 border border-red-200 p-8 text-center">
        <div class="text-red-600 mb-4">
          <svg class="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
          </svg>
        </div>
        <h3 class="text-lg font-semibold text-red-800 mb-2">HLS Not Supported</h3>
        <p class="text-red-600">Your browser doesn't support HLS streaming. Please try a modern browser like Chrome, Firefox, or Safari.</p>
      </div>
    `;
  }
}

// Dark mode functionality
function initializeDarkMode() {
  const darkModeToggle = document.getElementById('dark-mode-toggle');
  const html = document.documentElement;

  console.log('Initializing dark mode...', darkModeToggle);

  if (!darkModeToggle) {
    console.error('Dark mode toggle button not found!');
    return;
  }

  // Check for saved theme preference or default to light mode
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
    html.classList.add('dark');
  }

  // Toggle dark mode
  darkModeToggle.addEventListener('click', () => {

    html.classList.toggle('dark');
    
    // Save theme preference
    if (html.classList.contains('dark')) {
      localStorage.setItem('theme', 'dark');
      
    } else {
      localStorage.setItem('theme', 'light');
      
    }

    // Update chart theme if chart exists
    if (loadTimeChart) {
      updateChartTheme();
    }
  });
}

// Update chart theme based on dark mode
function updateChartTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  
  if (loadTimeChart) {
    const textColor = isDark ? '#E5E7EB' : '#374151';
    const gridColor = isDark ? 'rgba(75, 85, 99, 0.3)' : 'rgba(0, 0, 0, 0.1)';
    
    loadTimeChart.options.scales.x.ticks.color = textColor;
    loadTimeChart.options.scales.y.ticks.color = textColor;
    loadTimeChart.options.scales.x.title.color = textColor;
    loadTimeChart.options.scales.y.title.color = textColor;
    loadTimeChart.options.scales.x.grid.color = gridColor;
    loadTimeChart.options.scales.y.grid.color = gridColor;
    loadTimeChart.options.plugins.legend.labels.color = textColor;
    
    loadTimeChart.update('none');
  }
}

