import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfDay, endOfDay } from 'date-fns';
import { getCameras, getDetections, getImageUrl } from './api';
import type { DetectionSummary } from './types';
import './App.css';

export default function App() {
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [searchAllCameras, setSearchAllCameras] = useState<boolean>(false);
  const [detectionImages, setDetectionImages] = useState<Record<string, { raw?: string; processed?: string }>>({});
  const [expandedImage, setExpandedImage] = useState<string | null>(null);

  // Fetch cameras
  const { data: camerasData, isLoading: camerasLoading } = useQuery({
    queryKey: ['cameras'],
    queryFn: getCameras,
  });

  // Fetch detections when form is submitted
  const { data: detectionsData, isLoading: detectionsLoading, refetch: fetchDetections } = useQuery({
    queryKey: ['detections', selectedCameraId, selectedDate, searchAllCameras],
    queryFn: async () => {
      if (!selectedDate) {
        return null;
      }

      // If searching all cameras, require only date (not camera selection)
      if (!searchAllCameras && !selectedCameraId) {
        return null;
      }

      const date = new Date(selectedDate);
      const startEpoch = Math.floor(startOfDay(date).getTime() / 1000);
      const endEpoch = Math.floor(endOfDay(date).getTime() / 1000);

      const response = await getDetections({
        cameraId: searchAllCameras ? undefined : selectedCameraId,
        startDate: startEpoch.toString(),
        endDate: endEpoch.toString(),
      });

      // Filter to only show items with detections when searching all cameras
      if (searchAllCameras && response) {
        return {
          ...response,
          items: response.items.filter(item => item.detectionCount > 0),
          count: response.items.filter(item => item.detectionCount > 0).length,
        };
      }

      return response;
    },
    enabled: false, // Don't auto-fetch
  });

  // Get selected camera name
  const getCameraName = (cameraId: string): string => {
    return camerasData?.cameras.find(c => c.cameraId === cameraId)?.name || cameraId;
  };

  const selectedCameraName = searchAllCameras ? '' : getCameraName(selectedCameraId);

  const handleSearch = () => {
    if (!selectedDate) return;
    if (!searchAllCameras && !selectedCameraId) return;
    
    fetchDetections();
  };

  const loadImage = async (detection: DetectionSummary) => {
    const key = `${detection.cameraId}-${detection.capturedAtEpoch}`;
    
    if (detectionImages[key]) return;

    try {
      const [rawUrl, processedUrl] = await Promise.all([
        getImageUrl('raw', detection.rawImageKey),
        detection.processedImageKey ? getImageUrl('processed', detection.processedImageKey) : Promise.resolve(undefined),
      ]);

      setDetectionImages(prev => ({
        ...prev,
        [key]: { raw: rawUrl, processed: processedUrl },
      }));
    } catch (error) {
      console.error('Failed to load images:', error);
    }
  };

  return (
    <div className="app-container">
      {/* Hero Section */}
      <div className="hero-section">
        <h1 className="hero-title">Liikennekamerakuvat AI-analysoituna</h1>
        <p className="hero-subtitle">Selaa liikenekameroiden havaintoja</p>

        {/* Search Form - Google-style centered */}
        <div className="search-container">
          <div className="search-box">
            <div className="form-group">
              <label className="form-label">Valitse kamera</label>
              <select
                className="form-select"
                value={selectedCameraId}
                onChange={(e) => setSelectedCameraId(e.target.value)}
                disabled={camerasLoading || searchAllCameras}
              >
                <option value="">-- Valitse kamera --</option>
                {camerasData?.cameras.map((camera) => (
                  <option key={camera.cameraId} value={camera.cameraId}>
                    {camera.name} • {camera.municipality}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Valitse päivämäärä</label>
              <input
                type="date"
                className="form-input"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                max={format(new Date(), 'yyyy-MM-dd')}
              />
            </div>

            <div className="form-group checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={searchAllCameras}
                  onChange={(e) => setSearchAllCameras(e.target.checked)}
                  className="checkbox-input"
                />
                <span>Etsi päivämäärältä osumia kaikista asemista</span>
              </label>
            </div>

            <button
              className="search-button"
              onClick={handleSearch}
              disabled={(!searchAllCameras && !selectedCameraId) || !selectedDate || detectionsLoading}
            >
              {detectionsLoading ? (
                <span className="loading-spinner">Haetaan...</span>
              ) : (
                <span className="search-button-text">🔍 Hae havainnot</span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Results Section */}
      {detectionsData && (
        <div className="results-section">
          <div className="results-header">
            <h2 className="results-title">
              {detectionsData.count > 0 
                ? `Löytyi ${detectionsData.count} havaintoa` 
                : 'Ei havaintoja'}
            </h2>
          </div>

          {detectionsData.items.length === 0 ? (
            <div className="no-results">
              <span className="no-results-icon">📭</span>
              <p>Ei havaintoja valitulta päivältä</p>
            </div>
          ) : (
            <div className="detections-grid">
              {detectionsData.items.map((detection) => {
                const key = `${detection.cameraId}-${detection.capturedAtEpoch}`;
                const images = detectionImages[key];

                // Load images when detection is rendered
                if (!images) {
                  loadImage(detection);
                }

                return (
                  <div key={key} className="detection-card">
                    <div className="detection-header">
                      <div className="detection-info">
                        <div className="detection-camera">
                          {searchAllCameras ? getCameraName(detection.cameraId) : selectedCameraName}
                        </div>
                        <div className="detection-time">
                          <div><span className="time-label">Päivämäärä:</span> {format(new Date(detection.capturedAt), 'dd.MM.yyyy')}</div>
                          <div><span className="time-label">Kellonaika:</span> {format(new Date(detection.capturedAt), 'HH:mm:ss')}</div>
                        </div>
                      </div>
                      <div className="detection-badges">
                        {detection.hasWildlife && (
                          <span className="badge badge-wildlife">🦌 Villieläin</span>
                        )}
                        {detection.hasPerson && (
                          <span className="badge badge-person">👤 Ihminen</span>
                        )}
                      </div>
                    </div>

                    {detection.detectedClasses.length > 0 && (
                      <div className="detection-classes">
                        {detection.detectedClasses.join(' • ')}
                      </div>
                    )}

                    {/* Images side by side */}
                    <div className="images-container">
                      {/* Raw Image */}
                      <div className="image-wrapper">
                        <div className="image-label">Alkuperäinen</div>
                        {images?.raw ? (
                          <img
                            src={images.raw}
                            alt="Alkuperäinen kuva"
                            className="thumbnail"
                            onClick={() => setExpandedImage(images.raw!)}
                          />
                        ) : (
                          <div className="image-loading">
                            <div className="loading-spinner-small"></div>
                          </div>
                        )}
                      </div>

                      {/* Processed Image */}
                      <div className="image-wrapper">
                        <div className="image-label">Analysoitu</div>
                        {images?.processed ? (
                          <img
                            src={images.processed}
                            alt="Analysoitu kuva"
                            className="thumbnail"
                            onClick={() => setExpandedImage(images.processed!)}
                          />
                        ) : detection.processedImageKey ? (
                          <div className="image-loading">
                            <div className="loading-spinner-small"></div>
                          </div>
                        ) : (
                          <div className="image-unavailable">
                            Ei saatavilla
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="detection-footer">
                      <span className="detection-count">
                        {detection.detectionCount} havaintoa
                      </span>
                      <span className="detection-status">
                        {detection.processingStatus}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Image Modal */}
      {expandedImage && (
        <div className="modal-overlay" onClick={() => setExpandedImage(null)}>
          <div className="modal-content">
            <button className="modal-close" onClick={() => setExpandedImage(null)}>
              ✕
            </button>
            <img src={expandedImage} alt="Laajennettu kuva" className="modal-image" />
          </div>
        </div>
      )}
    </div>
  );
}
