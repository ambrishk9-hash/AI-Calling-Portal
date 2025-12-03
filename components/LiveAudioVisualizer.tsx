import React, { useEffect, useState } from 'react';

interface LiveAudioVisualizerProps {
  isActive: boolean;
  isSpeaking: boolean;
}

const LiveAudioVisualizer: React.FC<LiveAudioVisualizerProps> = ({ isActive, isSpeaking }) => {
  const [bars, setBars] = useState<number[]>(new Array(5).fill(10));

  useEffect(() => {
    if (!isActive) {
        setBars(new Array(5).fill(10));
        return;
    }

    const interval = setInterval(() => {
      setBars(prev => prev.map(() => {
        // If speaking, high random height. If listening (active but not speaking), low random hum.
        const min = isSpeaking ? 20 : 5;
        const max = isSpeaking ? 100 : 15;
        return Math.floor(Math.random() * (max - min + 1)) + min;
      }));
    }, 100);

    return () => clearInterval(interval);
  }, [isActive, isSpeaking]);

  return (
    <div className="flex items-center justify-center gap-1 h-12">
      {bars.map((height, i) => (
        <div
          key={i}
          className={`w-2 rounded-full transition-all duration-100 ease-in-out ${isSpeaking ? 'bg-indigo-500' : 'bg-slate-300'}`}
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
};

export default LiveAudioVisualizer;
