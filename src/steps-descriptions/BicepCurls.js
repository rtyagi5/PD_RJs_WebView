import React from "react";
import { Dumbbell, User, ArrowDownUp, Settings2 } from "lucide-react";

export default function BicepCurlsSetup() {
    return (
        <div className="max-w-2xl mx-auto p-5 bg-white rounded-2xl shadow-md space-y-6">
            {/* Title */}
            <h2 className="text-xl font-bold text-gray-900 text-center">
                💪 Bicep Curls – Setup Guide
            </h2>

            {/* Equipment */}
            <div className="bg-blue-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <Dumbbell className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Equipment</h3>
                </div>
                <p className="text-sm text-gray-600 text-center">
                    Dumbbells or resistance bands. Choose a weight that allows controlled movement without strain.
                </p>
            </div>

            {/* Stance */}
            <div className="bg-green-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <User className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Stance</h3>
                </div>
                <p className="text-sm text-gray-600 text-center">
                    Stand or sit upright with <span className="font-medium">feet shoulder-width apart</span>, arms relaxed at your sides. Keep your back straight and core engaged.
                </p>
            </div>

            {/* Direction */}
            <div className="bg-yellow-50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-center space-x-2">
                    <ArrowDownUp className="w-5 h-5 text-blue-600" />
                    <h3 className="text-base font-semibold text-gray-800">Movement Direction</h3>
                </div>
                <p className="text-sm text-gray-600 text-center">
                    Curl the dumbbells upward towards your shoulders while keeping elbows close to your body, then slowly lower back down. Repeat with controlled motion.
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
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Elbows should remain close to your torso, do not swing arms.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Lift the dumbbells in a slow and controlled manner.</li>
                    <li className="before:content-['•'] before:mr-2 before:text-purple-600">Lower weights fully before starting the next repetition.</li>
                </ul>
            </div>
        </div>
    );
}
