import React from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import './App.css';
import TheatreWorks from './pages/TheatreWorks';
import Music from './pages/Music';
import Contact from './pages/Contact';
import { MEDIA_PATHS, ROUTES } from './config/constants';

// Datos de las obras de teatro
const theatreWorks = [
  {
    id: 1,
    ...MEDIA_PATHS.CONCOURS_DE_LARMES
  },
  {
    id: 2,
    ...MEDIA_PATHS.QUI_A_PEUR
  }
];

function App() {
  return (
    <div className="App">
              <nav className="main-nav">
          <div className="nav-container">
            <div className="nav-links">
              <Link to="/" className="nav-link">Sound Design for Theatre</Link>
              <Link to="/music" className="nav-link">Music</Link>
              <Link to="/contact" className="nav-link">Contact</Link>
            </div>
          </div>
        </nav>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<TheatreWorks works={theatreWorks} />} />
          <Route path="/music" element={<Music />} />
          <Route path="/contact" element={<Contact />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
