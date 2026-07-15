import React from 'react';
import './Editorials.css';

const Editorials = () => {
    return (
        <div className="editorials-page-v3">
            {/* Story 1: Crosswalk Editorial */}
            <div className="editorial-section-crosswalk">
                <div className="editorial-container">
                    <div className="editorial-image-wrapper">
                        <h1 className="editorial-overlap-title">CROSSWALK</h1>
                        <img
                            src="/edit1.jpg"
                            alt="Editorial Crosswalk"
                            className="editorial-main-image"
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
                    <img src="/hero-slide-3.jpg" alt="Editorial Feature" className="feature-image-full" />
                </div>
            </div>

            {/* Story 3: Run Late Editorial */}
            <div className="editorial-split-run-late container reveal reveal-up">
                <div className="split-left-column">
                    <img src="/edit3.jpg" alt="Run Late Editorial" className="split-editorial-image" />
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
                    <img src="/edit4.1.jpg" alt="Merged Editorial Gallery" className="merged-editorial-image" />
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
                        <img
                            src="/edit5.jpg"
                            alt="Frugal Chic Editorial"
                            className="frugal-main-image"
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
                    <img src="/edit5.jpg" alt="Final Feature" className="final-editorial-image" />
                </div>
            </div>
        </div>
    );
};

export default Editorials;
