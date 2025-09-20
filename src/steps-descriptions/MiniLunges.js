import React from "react";
import { Dumbbell, User, ArrowDownUp, Settings2 } from "lucide-react";

export default function MiniLungesSetup() {
    return (
        <div className="max-w-2xl mx-auto p-5 bg-white rounded-2xl shadow-md space-y-6">
            {/* Title */}
            <h2 className="text-xl font-bold text-gray-900 text-center">
                🦵 Mini Lunges – Setup Guide
            </h2>

            {/* Equipment */}
            <div className="bg-blue-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <Dumbbell className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Equipment</h3>
                </div>
                <p className="text-sm text-gray-600 text-center">
                    No equipment required. Optional: light dumbbells for added resistance and a stable surface nearby for balance support.
                </p>
            </div>

            {/* Stance */}
            <div className="bg-green-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <User className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Stance</h3>
                </div>
                <p className="text-sm text-gray-600 text-center">
                    Stand upright with <span className="font-medium">feet hip-width apart</span> and hands relaxed at your sides. Keep your chest upright and core engaged.
                </p>
            </div>

            {/* Direction */}
            <div className="bg-yellow-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <ArrowDownUp className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Movement Direction</h3>
                </div>
                <p className="text-sm text-gray-600 text-center">
                    Step one foot forward into a <span className="font-medium">small lunge</span>, bend the knee slightly, then push back to standing. Alternate legs. Keep movement controlled.
                </p>
            </div>

            {/* Basic Setup */}
            <div className="bg-purple-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <Settings2 className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Basic Setup</h3>
                </div>
                <ul className="space-y-2 text-sm text-gray-600 text-left">
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Keep your back straight and core engaged throughout the movement.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Step forward only a small distance; avoid overextending.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Ensure knees track over your toes and do not collapse inward.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Perform the movement slowly and controlled, alternating legs.</li>
                </ul>
            </div>
        </div>
    );
}
