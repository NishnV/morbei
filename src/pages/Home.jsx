import React from 'react';
import { Link } from 'react-router-dom';
import Footer from '../components/Footer';
import { useFullpageSections } from '../hooks/useFullpageSections';
import '../styles/fullpage.css';
import './Home.css';

const TOTAL_SECTIONS = 4;

const Home = () => {
    const { sectionStyle, handleTouchStart, handleTouchEnd, floatingLogoPortal } = useFullpageSections(TOTAL_SECTIONS);

    return (
        <>
        {floatingLogoPortal}
        <div
            className="fp-page"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            {/* Section 0 — Hero */}
            <section className="fp-section fp-hero" style={{ ...sectionStyle(0), zIndex: 1 }}>
                <img src="/newhome/herosec.webp" alt="Hero" className="fp-hero-img" />
                <div className="fp-hero-cta">
                    <Link to="/shop/all" className="fp-hero-shop-link">SHOP</Link>
                </div>
            </section>

            {/* Section 1 — Editorial */}
            <section className="fp-section fp-editorial" style={{ ...sectionStyle(1), zIndex: 2 }}>
                <div className="fp-editorial-split">
                    <div className="fp-editorial-half">
                        <img loading="lazy" src="/campaign-1.webp" alt="Campaign" />
                    </div>
                    <div className="fp-editorial-half">
                        <img loading="lazy" src="/split-right.webp" alt="Campaign" />
                    </div>
                </div>
                <div className="fp-editorial-overlay">
                    <h2 className="fp-editorial-title">S/S '26</h2>
                    <Link to="/shop/new-in" className="fp-editorial-link">EXPLORE</Link>
                </div>
            </section>

            {/* Section 2 — Dresses / Categories */}
            <section className="fp-section fp-categories" style={{ ...sectionStyle(2), zIndex: 3 }}>
                <div className="fp-categories-grid">
                    <Link to="/shop/dresses" className="fp-cat-item">
                        <div className="fp-cat-img"><img loading="lazy" src="/campaign-1.webp" alt="Dresses" /></div>
                        <span className="fp-cat-label">DRESSES</span>
                    </Link>
                    <Link to="/shop/tops" className="fp-cat-item">
                        <div className="fp-cat-img"><img loading="lazy" src="/campaign-2.webp" alt="Tops" /></div>
                        <span className="fp-cat-label">TOPS</span>
                    </Link>
                    <Link to="/shop/bottoms" className="fp-cat-item">
                        <div className="fp-cat-img"><img loading="lazy" src="/edit5.webp" alt="Bottoms" /></div>
                        <span className="fp-cat-label">BOTTOMS</span>
                    </Link>
                </div>
            </section>

            {/* Section 3 — Footer */}
            <section className="fp-section fp-footer-section" style={{ ...sectionStyle(3), zIndex: 4 }}>
                <Footer showWordmark />
            </section>
        </div>
        </>
    );
};

export default Home;

