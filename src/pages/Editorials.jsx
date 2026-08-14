import React from 'react';
import './Editorials.css';
import SiteImage from '../components/SiteImage';

const Editorials = () => {
    return (
        <div className="editorials-page-v3">
            {/* Story 1: Crosswalk Editorial */}
            <div className="editorial-section-crosswalk">
                <div className="editorial-container">
                    <div className="editorial-image-wrapper">
                        <h1 className="editorial-overlap-title">CROSSWALK</h1>
                        <SiteImage
                            slot="editorial-crosswalk"
                            fallback="/edit1.webp"
                            alt="Editorial Crosswalk"
                            className="editorial-main-image"
                            width={1600} widths={[800, 1200, 1600]} sizes="100vw"
                            priority
                        />
                        <div className="editorial-description-wrapper">
                            <p className="editorial-description">
                                Modernism in movement. A series capturing the rhythm of the city and the poise of silhouettes in transit. Explored through the lens of a dynamic urban landscape, where every step tells a story of elegance and motion.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Story 2: Large Feature (Trench) */}
            <div className="editorial-feature-full reveal reveal-up">
                <div className="feature-image-container">
                    <SiteImage slot="editorial-feature" fallback="/hero-slide-3.webp" alt="Editorial Feature" className="feature-image-full" width={1600} widths={[800, 1200, 1600]} sizes="100vw" />
                </div>
            </div>

            {/* Story 3: Run Late Editorial */}
            <div className="editorial-split-run-late container reveal reveal-up">
                <div className="split-left-column">
                    <SiteImage slot="editorial-run-late" fallback="/edit3.webp" alt="Run Late Editorial" className="split-editorial-image" width={1200} widths={[600, 900, 1200]} sizes="50vw" />
                </div>
                <div className="split-right-column">
                    <div className="split-text-content">
                        <h2 className="split-title-bold">
                            RUN <span className="strike-through">LATE</span> IN <br /> STYLE
                        </h2>
                        <p className="split-paragraph">
                            The dawn of evening-wear that doesn't wait for the sun to set.
                            Oversized tailoring meets silk fluidity for the contemporary night,
                            redefining the rhythm of urban elegance.
                        </p>
                    </div>
                </div>
            </div>

            {/* Story 4: Merged Editorial Image */}
            <div className="editorial-story-v3 center full-width-story reveal reveal-up">
                <div className="story-hero-merged">
                    <SiteImage slot="editorial-gallery" fallback="/edit4.1.webp" alt="Merged Editorial Gallery" className="merged-editorial-image" width={1600} widths={[800, 1200, 1600]} sizes="100vw" />
                </div>
            </div>

            {/* Story 5: Frugal Chic Editorial */}
            <div className="editorial-section-frugal">
                <div className="editorial-container">
                    <header className="frugal-header">
                        <h2 className="frugal-title">
                            <span className="strike-through">FRUGAL</span> CHIC <br />
                            THEY CALL IT?
                        </h2>
                    </header>
                    <div className="frugal-image-wrapper reveal reveal-up">
                        <SiteImage
                            slot="editorial-frugal-chic"
                            fallback="/edit5.webp"
                            alt="Frugal Chic Editorial"
                            className="frugal-main-image"
                            width={1200} widths={[600, 900, 1200]} sizes="100vw"
                        />
                    </div>
                    <div className="frugal-description-wrapper reveal reveal-up">
                        <p className="frugal-description">
                            An exploration of understated luxury. When simplicity becomes the loudest statement in the room. A study in texture, silhouette, and the art of wearing nothing but confidence.
                        </p>
                    </div>
                </div>
            </div>

            {/* Story 6: Final Feature */}
            <div className="editorial-story-v3 full-width-story no-margin reveal reveal-up">
                <div className="story-hero-large-v3">
                    <SiteImage slot="editorial-final" fallback="/edit5.webp" alt="Final Feature" className="final-editorial-image" width={1600} widths={[800, 1200, 1600]} sizes="100vw" />
                </div>
            </div>
        </div>
    );
};

export default Editorials;
