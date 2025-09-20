import React from "react";
import { User, ArrowDownUp, Settings2 } from "lucide-react";

export default function StandingDorsiflexionSetup() {
    return (
        <div className="max-w-2xl mx-auto p-5 bg-white rounded-2xl shadow-md space-y-6">
            {/* Title */}
            <h2 className="text-xl font-bold text-gray-900 text-center">
                🦶 Standing Dorsiflexion – Setup Guide
            </h2>

            {/* Equipment */}
            <div className="bg-blue-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <h3 className="text-base font-semibold text-gray-800">Equipment</h3>
                </div>
                <p className="text-sm text-gray-600 text-center">
                    No equipment required. Optional: hold onto a stable surface (chair or wall) for balance.
                </p>
            </div>

            {/* Stance */}
            <div className="bg-green-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <User className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Stance</h3>
                </div>
                <p className="text-sm text-gray-600 text-center">
                    Stand upright with <span className="font-medium">feet hip-width apart</span>, knees slightly bent. Keep your back straight and core engaged. Hold onto a stable surface if needed for balance.
                </p>
            </div>

            {/* Direction */}
            <div className="bg-yellow-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <ArrowDownUp className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Movement Direction</h3>
                </div>
                <p className="text-sm text-gray-600 text-center">
                    Flex your foot upward toward your shin, then slowly lower it back down. Repeat for controlled repetitions, alternating feet if needed.
                </p>
            </div>

            {/* Basic Setup */}
            <div className="bg-purple-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <Settings2 className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Basic Setup</h3>
                </div>
                <ul className="space-y-2 text-sm text-gray-600 text-left">
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Keep your back straight and core engaged throughout the exercise.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Move your foot slowly and in a controlled manner; avoid jerking.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Hold onto a stable surface if balance is an issue.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Ensure enough space around your feet to avoid hitting objects.</li>
                </ul>
            </div>
        </div>
    );
}
